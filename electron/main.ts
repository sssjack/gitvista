import { setBundledGit, setBundledGitPreferred } from './git-runtime';
import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from 'electron';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import * as git from './git-service';
import { DEFAULT_PREFERENCES } from '../shared/types';
import type { AppSettings, GitAction, RepoEntry } from '../shared/types';
import { APP_THEMES, normalizeSettings, validatePreferences } from './settings-service';
import { msg, msgf, setMessageLanguage } from '../shared/messages';
import { canonicalRendererPath, createRendererUrlValidator } from './renderer-origin';
import { DesktopCompanion } from './desktop-companion';
import { clearCredentials, credentialUrl, rememberCredentials, validateCredentials } from './git-credentials';
import type { DesktopCommand, GitLogResult } from '../shared/types';

/**
 * 主进程的对话框与错误信息跟随界面语言。
 * Git 服务内部保持中文错误原文，在 IPC 边界统一查表翻译，
 * 这样服务层与测试都与语言无关，也不会漏掉某条新错误。
 */
function applyLanguage(language: AppSettings['language']): void {
  setMessageLanguage(language);
}
function localized(error: unknown): Error {
  const text = error instanceof Error ? error.message : String(error);
  const failure = /^Git 操作失败（(.+)，退出码 (-?\d+)）：([\s\S]*)$/.exec(text);
  return new Error(failure ? msgf('Git 操作失败（{0}，退出码 {1}）：{2}', failure[1], failure[2], failure[3]) : msg(text));
}

let window: BrowserWindow | null = null;
let miniWindow: BrowserWindow | null = null;
let settings: AppSettings = { ...DEFAULT_PREFERENCES, repos: [] };
let settingsPath = '';
let saveQueue = Promise.resolve();
let activeOperations = 0;
let executableChangeInProgress = false;
let pendingSettingsWrites = 0;
let closeNoticeOpen = false;
let companion: DesktopCompanion | undefined;
let quitting = false;
const approvedRepos = new Set<string>();
const devUrl = !app.isPackaged && process.env.GITVISTA_DEV_URL === 'http://127.0.0.1:5179' ? process.env.GITVISTA_DEV_URL : undefined;
const rendererFile = devUrl ? '' : canonicalRendererPath(path.join(__dirname, '../dist/index.html'));
const rendererUrlMatches = devUrl ? () => false : createRendererUrlValidator(rendererFile);
const miniRendererFile = devUrl ? '' : canonicalRendererPath(path.join(__dirname, '../dist/mini.html'));
const miniRendererUrlMatches = devUrl ? () => false : createRendererUrlValidator(miniRendererFile);
const repoKey = (value: string) => path.resolve(value).toLowerCase();

async function withOperation<T>(work: () => Promise<T>): Promise<T> {
  if (executableChangeInProgress) throw new Error('正在验证并切换 Git 程序，请稍后再执行 Git 操作。');
  activeOperations++;
  companion?.publish();
  try { return await work(); } finally { activeOperations--; companion?.publish(); }
}

function queueSettings<T>(work: () => Promise<T>): Promise<T> {
  pendingSettingsWrites++;
  const task = saveQueue.catch(() => {}).then(work).finally(() => { pendingSettingsWrites--; });
  saveQueue = task.then(() => {}, () => {});
  return task;
}
async function persist(next: AppSettings) {
  await fs.mkdir(path.dirname(settingsPath), { recursive: true });
  await fs.writeFile(`${settingsPath}.tmp`, JSON.stringify(next, null, 2), 'utf8');
  await fs.rename(`${settingsPath}.tmp`, settingsPath);
  settings = next;
  applyLanguage(next.language);
  companion?.publish();
}
async function registerRepo(value: string): Promise<RepoEntry> {
  const entry = await git.openRepository(value);
  await queueSettings(async () => {
    await persist({ ...settings, repos: [entry, ...settings.repos.filter(repo => repoKey(repo.path) !== repoKey(entry.path))].slice(0, 30), lastRepo: entry.path });
    approvedRepos.add(repoKey(entry.path));
  });
  void companion?.refresh();
  return entry;
}
function requireRepo(repo: unknown): asserts repo is string {
  if (typeof repo !== 'string' || !approvedRepos.has(repoKey(repo))) throw new Error('请先通过“打开仓库”选择此仓库。');
}
async function chooseDirectory(title: string): Promise<string | null> {
  const result = await dialog.showOpenDialog(window!, { title, properties: ['openDirectory', 'createDirectory'] });
  return result.canceled ? null : result.filePaths[0] || null;
}
const dangerousActions: Partial<Record<GitAction['type'], string>> = {
  discard: '丢弃所选文件的未暂存修改？这些修改无法通过 Git 找回。',
  reset: '重置当前分支？soft 保留暂存，mixed 取消暂存，hard 会丢弃已跟踪文件的未提交修改。',
  branchDelete: '删除所选本地分支？强制删除可能使尚未合并的提交失去分支引用。',
  tagDelete: '删除所选本地标签？',
  stashDrop: '删除这条储藏记录？尚未恢复的修改可能无法找回。',
  remoteRemove: '移除此远程配置及其远程跟踪引用？',
  worktreeRemove: '移除所选工作树？Git 将检查未提交修改。',
  rebase: '执行变基？此操作会改写当前分支的提交历史。',
  abort: '中止当前 Git 操作，并恢复该操作开始前的状态？',
  skip: '跳过当前提交？本次集成不会应用此提交的修改。',
  saveFile: '用编辑器中的内容覆盖此工作区文件？',
  resolve: '用所选冲突版本替换工作区文件？请确认保留的是你需要的内容。',
  revertFile: '撤销所选历史提交对该文件的改动？将反向应用到工作区（合并提交相对首个父提交），不会自动暂存或提交；重命名会同时处理新旧路径。',
  writeCommitGraph: '生成 Git 原生提交图和路径查询索引？此操作会写入仓库的 Git 元数据，大型仓库可能需要较长时间。这不等同于 IDEA 专用索引。',
};
function actionSummary(action: GitAction) {
  return [
    action.ref && msgf('引用：{0}', action.ref), action.name && msgf('名称：{0}', action.name), action.mode && msgf('模式：{0}', action.mode),
    action.paths?.length && msgf('文件：{0}', action.paths.join('、')), action.path && msgf('路径：{0}', action.path),
  ].filter(Boolean).join('\n');
}
function trustedSender(event: Electron.IpcMainInvokeEvent | Electron.IpcMainEvent, allowMini = false) {
  const target = event.sender === window?.webContents ? window : allowMini && event.sender === miniWindow?.webContents ? miniWindow : null;
  if (!target || event.senderFrame !== target.webContents.mainFrame) throw new Error('拒绝来自其他窗口的请求。');
  const url = event.senderFrame?.url || '';
  const valid = target === miniWindow
    ? (devUrl ? url === `${devUrl}/mini.html` : miniRendererUrlMatches(url))
    : (devUrl ? url.startsWith(`${devUrl}/`) : rendererUrlMatches(url));
  if (!valid) throw new Error('无效的应用页面。');
}
function handle(channel: string, fn: (...args: any[]) => unknown) {
  ipcMain.handle(channel, async (event, ...args) => {
    trustedSender(event, channel === 'gv:desktop:state' || channel === 'gv:desktop:command');
    // 服务层与校验层都写中文原文；在这里统一翻译，渲染进程永远拿到当前语言的文本。
    try { return await fn(...args); }
    catch (error) { throw localized(error); }
  });
}
function installHandlers() {
  handle('gv:desktop:state', () => companion?.state());
  handle('gv:desktop:command', (command: DesktopCommand) => companion?.command(command));
  handle('gv:directory', () => chooseDirectory(msg('选择克隆到的父目录')));
  handle('gv:credentials', async (repo, remote, value) => {
    requireRepo(repo);
    const credentials = value === null ? null : validateCredentials(value);
    const urls = (await git.credentialRemoteUrls(repo, remote)).map(credentialUrl);
    for (const url of urls) rememberCredentials(url, credentials);
  });
  handle('gv:settings', () => settings);
  handle('gv:theme', async theme => {
    if (!APP_THEMES.includes(theme)) throw new Error('不支持的主题。');
    await queueSettings(() => persist({ ...settings, theme }));
  });
  handle('gv:preferences', async value => {
    const preferences = validatePreferences(value);
    return queueSettings(async () => {
      const changingExecutable = preferences.gitPath !== settings.gitPath;
      if (changingExecutable && activeOperations > 0) throw new Error('Git 操作正在执行，请等待完成后再更换 Git 程序。');
      if (changingExecutable) executableChangeInProgress = true;
      try {
        if (changingExecutable) await git.testGitExecutable(preferences.gitPath);
        await persist({ ...settings, ...preferences });
        await git.configureGitExecutable(preferences.gitPath);
        return settings;
      } finally { if (changingExecutable) executableChangeInProgress = false; }
    });
  });
  handle('gv:git:browse', async () => {
    const result = await dialog.showOpenDialog(window!, {
      title: msg('选择 Git for Windows 程序'), properties: ['openFile'],
      filters: [{ name: msg('Git 程序（git.exe）'), extensions: ['exe'] }],
    });
    return result.canceled ? null : result.filePaths[0] || null;
  });
  handle('gv:git:test', async value => git.testGitExecutable(value));
  handle('gv:identity:get', async repo => {
    requireRepo(repo);
    return git.getGitIdentity(repo);
  });
  handle('gv:identity:set', async (repo, value) => {
    requireRepo(repo);
    const identity = git.validateIdentityUpdate(value);
    if (identity.scope === 'global') {
      const result = await dialog.showMessageBox(window!, {
        type: 'warning',
        title: msg('修改 Git 全局提交身份'), message: msg('保存为当前 Windows 用户的 Git 全局提交身份？'),
        detail: msgf('此设置会影响所有未单独覆盖身份的仓库。\n姓名：{0}\n邮箱：{1}',
          identity.name || msg('清除全局姓名，继承其他 Git 配置'),
          identity.email || msg('清除全局邮箱，继承其他 Git 配置')),
        buttons: [msg('取消'), msg('保存全局身份')], defaultId: 0, cancelId: 0, noLink: true,
      });
      if (result.response !== 1) throw new Error('已取消修改全局提交身份。');
    }
    requireRepo(repo);
    return withOperation(() => git.setGitIdentity(repo, identity));
  });
  handle('gv:open', async value => {
    const target = typeof value === 'string' && value.trim() ? value : await chooseDirectory(msg('打开 Git 仓库'));
    if (!target) return null;
    try { return await registerRepo(target); }
    catch (error) {
      if (!/not a git repository/i.test(String(error))) throw error;
      const result = await dialog.showMessageBox(window!, { type: 'question', title: msg('打开本地文件夹…'), message: msg('此文件夹不是 Git 仓库。是否初始化后打开？'), detail: target, buttons: [msg('取消'), msg('初始化并打开')], defaultId: 0, cancelId: 0 });
      if (result.response !== 1) return null;
      const entry = await withOperation(() => git.initRepository(target));
      return registerRepo(entry.path);
    }
  });
  handle('gv:forget', async repo => {
    requireRepo(repo);
    await queueSettings(async () => {
      const repos = settings.repos.filter(item => repoKey(item.path) !== repoKey(repo));
      const lastRepo = settings.lastRepo && repoKey(settings.lastRepo) === repoKey(repo) ? repos[0]?.path : settings.lastRepo;
      await persist({ ...settings, repos, lastRepo });
      approvedRepos.delete(repoKey(repo));
    });
    void companion?.refresh();
  });
  handle('gv:clone', async (url, parent, name, credentials) => {
    if (typeof url !== 'string' || !url.trim()) throw new Error('请输入远程仓库地址。');
    const destination = typeof parent === 'string' && parent ? parent : await chooseDirectory(msg('选择克隆到的父目录'));
    if (!destination) return null;
    const entry = await withOperation(() => git.cloneRepository(url, destination, name, credentials));
    if (credentials) rememberCredentials(url, credentials);
    return registerRepo(entry.path);
  });
  handle('gv:init', async value => {
    const target = typeof value === 'string' && value ? value : await chooseDirectory('选择要初始化的目录');
    if (!target) return null;
    const confirmation = await dialog.showMessageBox(window!, { type: 'question', title: msg('初始化 Git 仓库'), message: msg('在此目录创建 Git 仓库？'), detail: target, buttons: [msg('取消'), msg('初始化')], defaultId: 0, cancelId: 0 });
    if (confirmation.response !== 1) return null;
    const entry = await withOperation(() => git.initRepository(target));
    return registerRepo(entry.path);
  });
  handle('gv:query', async (repo, query) => { requireRepo(repo); return git.query(repo, query); });
  handle('gv:action', async (repo, action: GitAction) => {
    requireRepo(repo);
    if (!action || typeof action.type !== 'string') throw new Error('无效的 Git 操作。');
    if (action.type === 'pull' && !action.mode && action.rebase === undefined) action = { ...action, mode: settings.pullStrategy };
    const prompt = action.type === 'push' && action.force ? '使用 force-with-lease 推送？远端历史可能被替换。' : action.type === 'commit' && action.amend ? '修改上一条提交？这会产生新的提交哈希。' : dangerousActions[action.type];
    if (prompt) {
      const confirmed = await dialog.showMessageBox(window!, { type: 'warning', title: msg('确认 Git 操作'), message: msg(prompt), detail: `${msg('仓库')}：${repo}\n${actionSummary(action)}`, buttons: [msg('取消'), msg('确认执行')], defaultId: 0, cancelId: 0, noLink: true });
      if (confirmed.response !== 1) throw new Error('已取消操作。');
    }
    try { return await withOperation(() => git.action(repo, action)); }
    finally { void companion?.refresh(); }
  });
  handle('gv:export', async (repo, ref) => {
    requireRepo(repo);
    const content = await git.exportPatch(repo, ref);
    const result = await dialog.showSaveDialog(window!, { title: msg('导出补丁'), defaultPath: path.join(app.getPath('documents'), `gitvista-${Date.now()}.patch`), filters: [{ name: msg('Git 补丁'), extensions: ['patch', 'diff'] }] });
    if (result.canceled || !result.filePath) return null;
    await fs.writeFile(result.filePath, content, 'utf8');
    return result.filePath;
  });
  handle('gv:reveal', async (repo, relative) => {
    requireRepo(repo);
    if (!relative) { const result = await shell.openPath(repo); if (result) throw new Error(result); return; }
    if (typeof relative !== 'string') throw new Error('无效文件路径。');
    const destination = path.resolve(repo, relative);
    const realRepo = await fs.realpath(repo);
    const realDestination = await fs.realpath(destination);
    const relation = path.relative(realRepo, realDestination);
    if (relation.startsWith('..') || path.isAbsolute(relation) || relation.split(path.sep).includes('.git')) throw new Error('只能打开仓库内部文件。');
    shell.showItemInFolder(realDestination);
  });
  ipcMain.on('gv:window', (event, action) => {
    trustedSender(event);
    if (action === 'minimize') window?.minimize();
    if (action === 'maximize') window?.isMaximized() ? window.unmaximize() : window?.maximize();
    if (action === 'close') window?.close();
  });
}
async function createWindow() {
  window = new BrowserWindow({
    width: 1560, height: 1000, minWidth: 1120, minHeight: 740,
    title: 'GitVista', backgroundColor: '#16181d', frame: false, icon: path.join(__dirname, '../assets/icon.png'),
    show: process.env.GITVISTA_TEST !== '1',
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, spellcheck: false },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  window.on('close', event => {
    if (!quitting && companion) { event.preventDefault(); companion.hide(); return; }
    if (activeOperations === 0 && !executableChangeInProgress && pendingSettingsWrites === 0) return;
    event.preventDefault();
    if (closeNoticeOpen) return;
    closeNoticeOpen = true;
    void dialog.showMessageBox(window!, { type: 'info', title: msg('操作正在执行'), message: msg('请等待当前 Git 操作或设置保存完成后关闭窗口。'), buttons: [msg('继续等待')] }).finally(() => { closeNoticeOpen = false; });
  });
  window.on('closed', () => { window = null; });
  if (devUrl) await window.loadURL(devUrl); else await window.loadFile(rendererFile);
}
async function createMiniWindow() {
  miniWindow = new BrowserWindow({
    width: 128, height: 40, frame: false, transparent: true, backgroundColor: '#00000000',
    thickFrame: false, hasShadow: false, resizable: false, maximizable: false,
    skipTaskbar: true, alwaysOnTop: true, show: false, title: 'GitVista Mini',
    webPreferences: { preload: path.join(__dirname, 'mini-preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, spellcheck: false },
  });
  miniWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  miniWindow.webContents.on('will-navigate', event => event.preventDefault());
  miniWindow.on('close', event => { if (!quitting) { event.preventDefault(); companion?.hide(); } });
  miniWindow.on('closed', () => { miniWindow = null; });
  if (devUrl) await miniWindow.loadURL(`${devUrl}/mini.html`); else await miniWindow.loadFile(miniRendererFile);
}
if (process.env.GITVISTA_USER_DATA && !app.isPackaged) app.setPath('userData', path.resolve(process.env.GITVISTA_USER_DATA));
const hasLock = app.requestSingleInstanceLock();
if (!hasLock) app.quit();
else {
  app.on('second-instance', () => { companion?.restore(); });
  app.on('before-quit', event => {
    if (activeOperations || pendingSettingsWrites || executableChangeInProgress) {
      event.preventDefault(); quitting = false;
      if (!closeNoticeOpen && window) {
        closeNoticeOpen = true;
        void dialog.showMessageBox(window, { type: 'info', title: msg('操作正在执行'), message: msg('请等待当前 Git 操作或设置保存完成后关闭窗口。') }).finally(() => { closeNoticeOpen = false; });
      }
      return;
    }
    quitting = true;
  });
  app.on('will-quit', () => { companion?.dispose(); clearCredentials(); });
  app.whenReady().then(async () => {
    Menu.setApplicationMenu(null);
    settingsPath = path.join(app.getPath('userData'), 'settings.json');
    try {
      const loaded = JSON.parse(await fs.readFile(settingsPath, 'utf8'));
      settings = normalizeSettings(loaded);
    } catch { /* 首次运行使用默认设置。 */ }
    // 在读取设置之后立即同步语言，之后的对话框与错误信息才有正确的语言。
    applyLanguage(settings.language);
    setBundledGit(app.isPackaged ? path.join(process.resourcesPath, 'git') : path.join(__dirname, '../vendor/mingit'));
    // 开发态优先使用系统 Git，打包后优先使用内置 Git，避免本机已装的 Git 版本差异影响调试。
    setBundledGitPreferred(app.isPackaged);
    await git.configureGitExecutable(settings.gitPath);
    for (const repo of settings.repos) approvedRepos.add(repoKey(repo.path));
    const repoArgument = process.argv.find(value => value.startsWith('--repo='));
    if (repoArgument) { try { await registerRepo(repoArgument.slice(7)); } catch (error) { console.error('打开启动仓库失败：', (error as Error).message); } }
    installHandlers();
    await createWindow();
    await createMiniWindow();
    companion = new DesktopCompanion(window!, miniWindow!, {
      settings: () => settings, busy: () => activeOperations > 0 || pendingSettingsWrites > 0 || executableChangeInProgress,
      log: async repo => { requireRepo(repo); try { return await git.query(repo, { type: 'log', log: { branch: 'HEAD', limit: 5 } }) as GitLogResult; } catch (error) { throw localized(error); } },
      pull: async repo => { requireRepo(repo); try { return await withOperation(() => git.action(repo, { type: 'pull', mode: settings.pullStrategy })); } catch (error) { throw localized(error); } },
      quit: () => app.quit(),
    });
    app.on('activate', () => { if (!window) void createWindow(); });
  }).catch(error => { dialog.showErrorBox(msg('GitVista 无法启动'), String(error)); app.quit(); });
  app.on('window-all-closed', () => { app.quit(); });
}
