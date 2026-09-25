import { resolveGit, gitEnvironment } from './git-runtime';
import { spawn } from 'node:child_process';
import { isUtf8 } from 'node:buffer';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { msgf } from '../shared/messages';
import type { AppLanguage, ActionResult, PushPreview, CommitDetail, DiffResult, GitAction, GitCommit, GitIdentity, GitIdentityUpdate, GitLogOptions, GitLogResult, GitQuery, GitRemote, GitSnapshot, GitTreeEntry, GitWorkingState, IdentityFields, RepoEntry } from '../shared/types';
import { COMMIT_FORMAT, parseBranches, parseCommits, parseNameChanges, parseNumstat, parseStashes, parseStatus, parseTags, parseWorktrees } from './git-parse';
import { normalizeGitPath } from './settings-service';

const MAX_OUTPUT = 16 * 1024 * 1024;
const MAX_DIFF = 2 * 1024 * 1024;
const MAX_FILE = 4 * 1024 * 1024;
const DEFAULT_TIMEOUT = 45_000;
const NETWORK_TIMEOUT = 300_000;
const queues = new Map<string, Promise<unknown>>();
const pendingRoots = new Map<string, Promise<string>>();
let gitExecutable = 'git';
let versionCache: { executable: string; value: Promise<string> } | undefined;
const GLOBAL_ARGS = ['--no-pager', '--literal-pathspecs', '-c', 'color.ui=false', '-c', 'core.quotepath=false', '-c', 'core.fsmonitor=false', '-c', 'credential.interactive=false'];

interface RunOptions { input?: string; timeout?: number; allowCodes?: number[]; maxOutput?: number; requireUtf8?: boolean; executable?: string }
interface RunResult { stdout: string; stderr: string; code: number }

function cleanError(value: string): string {
  return value.replace(/(https?:\/\/)[^\s/@]+@/gi, '$1***@').replace(/\x1b\[[0-9;]*m/g, '').trim().slice(0, 6000);
}

function run(cwd: string, args: string[], options: RunOptions = {}): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(options.executable || gitExecutable, [...GLOBAL_ARGS, ...args], {
      cwd, shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...gitEnvironment(options.executable || gitExecutable), LC_ALL: 'C', LANG: 'C', GIT_TERMINAL_PROMPT: '0',
        GCM_INTERACTIVE: 'Never', GIT_OPTIONAL_LOCKS: '0', GIT_EDITOR: 'true', GIT_SEQUENCE_EDITOR: 'true',
        GIT_SSH_COMMAND: process.env.GIT_SSH_COMMAND || 'ssh -o BatchMode=yes',
      },
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let size = 0;
    let failure: Error | undefined;
    const timer = setTimeout(() => {
      failure = new Error('Git 操作超时，请检查网络、凭据或仓库锁后重试。');
      child.kill();
    }, options.timeout ?? DEFAULT_TIMEOUT);
    const collect = (target: Buffer[]) => (chunk: Buffer) => {
      size += chunk.length;
      if (size > (options.maxOutput ?? MAX_OUTPUT)) {
        failure = new Error('Git 输出超过安全限制，请缩小文件、提交或查询范围。');
        child.kill();
        return;
      }
      target.push(chunk);
    };
    child.stdout.on('data', collect(stdout));
    child.stderr.on('data', collect(stderr));
    child.on('error', error => {
      clearTimeout(timer);
      reject(new Error((error as NodeJS.ErrnoException).code === 'ENOENT'
        ? '未找到 Git，请在设置中选择有效的 git.exe，或将 Git 加入 PATH。'
        : `无法启动 Git：${cleanError(error.message)}`));
    });
    child.stdin.on('error', () => { /* Git 可能在读取输入前退出，实际错误由 close 处理。 */ });
    child.on('close', code => {
      clearTimeout(timer);
      if (failure) { reject(failure); return; }
      const rawOutput = Buffer.concat(stdout);
      if (options.requireUtf8 && !isUtf8(rawOutput)) {
        reject(new Error('此文件不是有效的 UTF-8 文本，请使用支持原始编码的外部编辑器，避免保存时破坏内容。'));
        return;
      }
      const result = { stdout: rawOutput.toString('utf8'), stderr: Buffer.concat(stderr).toString('utf8'), code: code ?? -1 };
      if (result.code !== 0 && !(options.allowCodes || []).includes(result.code)) {
        const detail = cleanError(result.stderr || result.stdout);
        if (/(?:unable to read tree|bad tree object|missing (?:tree|blob) object)/i.test(detail)) {
          reject(new Error(`此历史版本引用的 Git 对象不可读取，无法显示完整差异。可先查看其他提交或工作区文件；请确认仓库对象完整后重试。\n${detail}`));
          return;
        }
        reject(new Error(`Git 操作失败（${args[0]}，退出码 ${result.code}）：${detail || '请检查仓库状态。'}`));
        return;
      }
      resolve(result);
    });
    child.stdin.end(options.input);
  });
}

async function output(repo: string, args: string[], options?: RunOptions): Promise<string> {
  return (await run(repo, args, options)).stdout;
}

export async function configureGitExecutable(value: string): Promise<void> {
  gitExecutable = await resolveGit(normalizeGitPath(value));
  if (versionCache?.executable !== gitExecutable) versionCache = undefined;
}

function gitVersion(repo: string): Promise<string> {
  if (versionCache?.executable === gitExecutable) return versionCache.value;
  const executable = gitExecutable;
  const value = output(repo, ['--version'], { executable }).then(result => result.trim());
  versionCache = { executable, value };
  void value.catch(() => { if (versionCache?.value === value) versionCache = undefined; });
  return value;
}

export async function testGitExecutable(value: string): Promise<{ version: string }> {
  const executable = await resolveGit(normalizeGitPath(value));
  if (executable !== 'git') {
    try {
      if (!(await fs.stat(executable)).isFile()) throw new Error('所选路径不是文件。');
    } catch (error) {
      throw new Error(`无法读取所选 Git 程序：${cleanError((error as Error).message)}`);
    }
  }
  const result = await run(process.cwd(), ['--version'], { executable, timeout: 10_000, maxOutput: 64 * 1024 });
  const version = result.stdout.trim();
  if (!/^git version \d+\.\d+[^\r\n]*$/.test(version)) throw new Error('所选程序没有返回有效的 Git 版本，请选择 Git for Windows 的 git.exe。');
  return { version };
}

export function validateIdentityUpdate(value: unknown): GitIdentityUpdate {
  if (!value || typeof value !== 'object') throw new Error('提交身份设置不正确。');
  const identity = value as Record<string, unknown>;
  if (identity.scope !== 'local' && identity.scope !== 'global') throw new Error('提交身份只能保存到当前仓库或全局配置。');
  for (const key of ['name', 'email']) {
    if (typeof identity[key] !== 'string' || (identity[key] as string).length > 256 || /[\x00-\x1f\x7f<>]/.test(identity[key] as string)) {
      throw new Error('提交姓名和邮箱必须是单行文本，且不能包含控制字符或尖括号。');
    }
  }
  const name = (identity.name as string).trim();
  const email = (identity.email as string).trim();
  if (email && !/^[^\s@]+@[^\s@]+$/.test(email)) throw new Error('请输入有效的提交邮箱，或留空以清除此范围的邮箱配置。');
  return { scope: identity.scope, name, email };
}

async function readIdentity(repo: string): Promise<GitIdentity> {
  const scoped = async (scope?: 'local' | 'global'): Promise<IdentityFields> => {
    const read = async (key: 'user.name' | 'user.email'): Promise<string> => {
      const result = await run(repo, ['config', '--includes', ...(scope ? [`--${scope}`] : []), '--get', key], { allowCodes: [1], maxOutput: 64 * 1024 });
      return result.code === 1 ? '' : result.stdout.replace(/\r?\n$/, '');
    };
    const [name, email] = await Promise.all([read('user.name'), read('user.email')]);
    return { name, email };
  };
  const [local, global, effective] = await Promise.all([scoped('local'), scoped('global'), scoped()]);
  return { local, global, effective };
}

export async function getGitIdentity(directory: string): Promise<GitIdentity> {
  const repo = await rootOf(directory);
  await waitForMutation(repo);
  return readIdentity(repo);
}

export async function setGitIdentity(directory: string, value: GitIdentityUpdate): Promise<GitIdentity> {
  const identity = validateIdentityUpdate(value);
  const repo = await rootOf(directory);
  return serialized('gitvista:identity-settings', () => serialized(repo, async () => {
    try {
      for (const [key, content] of [['user.name', identity.name], ['user.email', identity.email]]) {
        if (content) await run(repo, ['config', `--${identity.scope}`, '--replace-all', '--', key, content]);
        else await run(repo, ['config', `--${identity.scope}`, '--unset-all', '--', key], { allowCodes: [5] });
      }
    } catch (error) {
      throw new Error(`保存提交身份失败，请重新读取以核对是否有部分字段已保存：${cleanError((error as Error).message)}`);
    }
    return readIdentity(repo);
  }));
}

function required(value: unknown, label: string, max = 2048): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max || value.includes('\0')) throw new Error(`${label}为空或格式不正确。`);
  return value;
}

function ref(value: unknown, fallback?: string): string {
  const result = required(value === '' || value === undefined || value === null ? fallback : value, 'Git 引用', 512).trim();
  if (result.startsWith('-') || /[\r\n\0]/.test(result) || result.includes(':')) throw new Error('Git 引用格式不正确。');
  return result;
}

async function commitRef(repo: string, value: unknown, fallback?: string): Promise<string> {
  return (await output(repo, ['rev-parse', '--verify', '--end-of-options', `${ref(value, fallback)}^{commit}`])).trim();
}

async function hasHead(repo: string): Promise<boolean> {
  return (await run(repo, ['rev-parse', '--verify', '--quiet', 'HEAD'], { allowCodes: [1, 128] })).code === 0;
}

function pathInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

async function noSymlink(absolute: string, boundary?: string, checked?: Map<string, Promise<void>>): Promise<void> {
  let cursor = absolute;
  while (true) {
    const key = process.platform === 'win32' ? cursor.toLowerCase() : cursor;
    let check = checked?.get(key);
    if (!check) {
      const current = cursor;
      check = (async () => {
        try {
          const stat = await fs.lstat(current);
          if (stat.isSymbolicLink()) throw new Error('为避免写入仓库外部，不能操作符号链接或目录联接。');
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        }
      })();
      checked?.set(key, check);
    }
    await check;
    if (boundary && path.relative(boundary, cursor) === '') return;
    const parent = path.dirname(cursor);
    if (parent === cursor) return;
    cursor = parent;
  }
}

async function safePath(repo: string, value: unknown, allowRoot = false, checked?: Map<string, Promise<void>>): Promise<string> {
  const candidate = required(value, '文件路径', 8192).replace(/\\/g, '/');
  if (path.isAbsolute(candidate) || /^[a-z]:/i.test(candidate) || candidate.includes(':') || candidate.split('/').some(segment => segment.toLowerCase().replace(/[. ]+$/, '') === '.git' || segment.toLowerCase() === '.git')) {
    throw new Error('只能操作仓库内的普通文件，不能访问 .git 或绝对路径。');
  }
  const absolute = path.resolve(repo, candidate);
  if (!pathInside(repo, absolute) || (!allowRoot && path.relative(repo, absolute) === '')) throw new Error('文件路径不能越过仓库目录。');
  await noSymlink(absolute, repo, checked);
  return path.relative(repo, absolute).split(path.sep).join('/') || '.';
}

async function safePaths(repo: string, values: unknown): Promise<string[]> {
  if (!Array.isArray(values) || values.length === 0 || values.length > 10_000) throw new Error('请先选择文件（最多 10000 个）。');
  // 仅在本次批量校验内复用父目录检查，避免大量同目录文件反复访问磁盘；不跨操作缓存安全状态。
  const checked = new Map<string, Promise<void>>();
  return [...new Set(await Promise.all([...new Set(values)].map(value => safePath(repo, value, false, checked))))];
}

async function rootOf(directory: string): Promise<string> {
  const candidate = path.resolve(required(directory, '仓库目录', 8192));
  const key = `${gitExecutable}\0${process.platform === 'win32' ? candidate.toLowerCase() : candidate}`;
  const pending = pendingRoots.get(key);
  if (pending) return pending;
  // 合并两个 rev-parse，并只共享并行校验；不长期缓存目录，避免仓库移走或被替换后继续使用旧根目录。
  const task = (async () => {
    const result = (await output(candidate, ['rev-parse', '--show-toplevel', '--is-bare-repository'])).trimEnd().split(/\r?\n/);
    const bare = result.pop();
    if (bare === 'true') throw new Error('请选择带工作区的 Git 仓库，当前版本不直接编辑裸仓库。');
    if (bare !== 'false' || !result.length) throw new Error('无法确认 Git 仓库的工作区目录。');
    return fs.realpath(result.join('\n'));
  })();
  pendingRoots.set(key, task);
  try { return await task; } finally { if (pendingRoots.get(key) === task) pendingRoots.delete(key); }
}

function serialized<T>(repo: string, work: () => Promise<T>): Promise<T> {
  const key = process.platform === 'win32' ? repo.toLowerCase() : repo;
  const before = queues.get(key) || Promise.resolve();
  const task = before.catch(() => undefined).then(work);
  queues.set(key, task);
  void task.finally(() => { if (queues.get(key) === task) queues.delete(key); }).catch(() => undefined);
  return task;
}

async function waitForMutation(repo: string): Promise<void> {
  const key = process.platform === 'win32' ? repo.toLowerCase() : repo;
  await queues.get(key)?.catch(() => undefined);
}

async function exists(candidate: string): Promise<boolean> {
  try { await fs.access(candidate); return true; } catch { return false; }
}

async function operation(repo: string): Promise<string> {
  const markerNames = ['rebase-merge', 'rebase-apply', 'MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'BISECT_LOG', 'rebase-apply/applying', 'sequencer/todo'];
  // --git-path 保留 linked worktree 的路径语义，一次定位所有标记，减少 Windows 上启动 Git 的成本。
  const markerPaths = (await output(repo, ['rev-parse', ...markerNames.flatMap(name => ['--git-path', name])])).trimEnd().split(/\r?\n/).map(value => path.resolve(repo, value));
  if (markerPaths.length !== markerNames.length) throw new Error('无法读取完整的 Git 操作状态路径。');
  const markers = await Promise.all(markerPaths.slice(0, 7).map(value => exists(value)));
  if (markers[0]) return 'rebase';
  if (markers[1]) {
    return markers[6] ? 'am' : 'rebase';
  }
  if (markers[2]) return 'merge';
  if (markers[3]) return 'cherry-pick';
  if (markers[4]) return 'revert';
  if (markers[5]) return 'bisect';
  try {
    const todo = await fs.readFile(markerPaths[7], 'utf8');
    if (todo.startsWith('pick ')) return 'cherry-pick';
    if (todo.startsWith('revert ')) return 'revert';
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  return '';
}

async function workingState(repo: string): Promise<GitWorkingState> {
  const [statusText, currentOperation] = await Promise.all([
    output(repo, ['status', '--porcelain=v1', '-z', '--untracked-files=all']), operation(repo),
  ]);
  return { files: parseStatus(statusText).files, operation: currentOperation };
}

function logArgs(request: GitQuery): string[] {
  const limit = Math.min(500, Math.max(1, Math.floor(Number(request.limit) || 200)));
  const args = [`--max-count=${limit}`, '--date-order', '--decorate=short', `--format=${COMMIT_FORMAT}`];
  if (request.search?.trim()) args.push('--fixed-strings', `--grep=${required(request.search, '搜索内容', 1000)}`);
  if (request.author?.trim()) args.push(`--author=${required(request.author, '作者', 1000)}`);
  return args;
}

function logNumber(value: unknown, fallback: number, minimum: number, maximum: number, label: string): number {
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < minimum || value > maximum) throw new Error(`${label}不正确。`);
  return value;
}

function logDate(value: unknown, label: string, endOfDay: boolean): string | undefined {
  if (value === undefined || value === '') return undefined;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`${label}必须为 YYYY-MM-DD。`);
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime()) || date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) throw new Error(`${label}不是有效日期。`);
  if (endOfDay) date.setHours(23, 59, 59, 999);
  return date.toISOString();
}

function escapeRegex(value: string): string { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

async function commitSummary(repo: string, requested: unknown): Promise<GitCommit> {
  const hash = await commitRef(repo, requested);
  return parseCommits(await output(repo, ['show', '-s', `--format=${COMMIT_FORMAT}`, hash, '--']))[0];
}

async function logHistory(repo: string, value?: GitLogOptions): Promise<GitLogResult> {
  if (value !== undefined && (!value || typeof value !== 'object' || Array.isArray(value))) throw new Error('日志筛选条件不正确。');
  const options = value || {};
  const limit = logNumber(options.limit, 250, 1, 500, '每页提交数');
  const skip = logNumber(options.skip, 0, 0, 10_000_000, '日志分页位置');
  for (const flag of ['regex', 'matchCase', 'firstParent', 'noMerges'] as const) {
    if (options[flag] !== undefined && typeof options[flag] !== 'boolean') throw new Error('日志筛选开关不正确。');
  }
  if (options.order !== undefined && options.order !== 'date' && options.order !== 'topo') throw new Error('不支持的日志排序。');
  const since = logDate(options.since, '开始日期', false);
  const until = logDate(options.until, '结束日期', true);
  if (since && until && since > until) throw new Error('开始日期不能晚于结束日期。');
  const text = options.text === undefined || options.text === '' ? '' : required(options.text, '搜索内容', 1000).trim();
  const author = options.author === undefined || options.author === '' ? '' : required(options.author, '作者', 1000).trim();
  const selectedPaths = options.paths === undefined || (Array.isArray(options.paths) && options.paths.length === 0) ? [] : await safePaths(repo, options.paths);
  const branch = options.branch ? await commitRef(repo, options.branch) : undefined;
  const revisions = branch ? [branch] : ['--all'];
  const filters = [options.order === 'topo' ? '--topo-order' : '--date-order', options.regex ? '--extended-regexp' : '--fixed-strings'];
  if (!options.matchCase) filters.push('--regexp-ignore-case');
  if (author) filters.push(`--author=${options.regex ? escapeRegex(author) : author}`);
  if (since) filters.push(`--since-as-filter=${since}`);
  if (until) filters.push(`--until=${until}`);
  if (options.firstParent) filters.push('--first-parent');
  if (options.noMerges) filters.push('--no-merges');
  // 哈希定位在 Git 端验证可达范围；不能只在已加载的一页提交中查找。
  let hashMatch: string | undefined;
  if (text && !options.regex && /^[a-f0-9]{4,64}$/i.test(text)) {
    const resolved = await run(repo, ['rev-parse', '--verify', '--quiet', '--end-of-options', `${text}^{commit}`], { allowCodes: [1, 128] });
    if (resolved.code === 0) hashMatch = resolved.stdout.trim();
  }
  if (hashMatch) {
    let reachable: boolean;
    if (branch) reachable = (await run(repo, ['merge-base', '--is-ancestor', hashMatch, branch], { allowCodes: [1] })).code === 0;
    else {
      const containing = await output(repo, ['for-each-ref', '--count=1', `--contains=${hashMatch}`, '--format=%(refname)']);
      reachable = !!containing.trim() || ((await hasHead(repo)) && (await run(repo, ['merge-base', '--is-ancestor', hashMatch, 'HEAD'], { allowCodes: [1] })).code === 0);
    }
    if (reachable && options.firstParent) {
      const ancestors = await output(repo, ['rev-list', '--first-parent', ...revisions, '--']);
      reachable = ancestors.split('\n').includes(hashMatch);
    }
    if (!reachable || skip > 0) return { commits: [], hasMore: false, nextSkip: skip };
    // ^! 仅包含该提交，仍让 Git 应用路径过滤；--no-walk 会绕过路径简化。
    const commits = parseCommits(await output(repo, ['log', '--max-count=1', ...filters, '--decorate=short', `--format=${COMMIT_FORMAT}`, `${hashMatch}^!`, '--', ...selectedPaths]));
    return { commits, hasMore: false, nextSkip: skip + commits.length };
  }
  if (text) filters.push(`--grep=${text}`);
  const all = parseCommits(await output(repo, ['log', `--max-count=${limit + 1}`, `--skip=${skip}`, ...filters, '--decorate=short', `--format=${COMMIT_FORMAT}`, ...revisions, '--', ...selectedPaths]));
  const commits = all.slice(0, limit);
  return { commits, hasMore: all.length > limit, nextSkip: skip + commits.length };
}

async function remoteList(repo: string): Promise<GitRemote[]> {
  const remotes = new Map<string, GitRemote>();
  for (const line of (await output(repo, ['remote', '-v'])).split(/\r?\n/)) {
    const match = /^(\S+)\t(.*) \((fetch|push)\)$/.exec(line);
    if (!match) continue;
    const [, name, url, direction] = match;
    const remote = remotes.get(name) || { name, fetch: '', push: '' };
    // 与 get-url 的默认行为一致，显示每个方向的首个地址（Git 已应用 insteadOf 重写）。
    if (!remote[direction as 'fetch' | 'push']) remote[direction as 'fetch' | 'push'] = cleanError(url);
    remotes.set(name, remote);
  }
  return [...remotes.values()];
}

async function snapshot(repo: string, request: GitQuery): Promise<GitSnapshot> {
  const limit = Math.min(500, Math.max(1, Math.floor(Number(request.limit) || 200)));
  const historyArgs = logArgs(request).map(value => value === '--date-order' ? '--topo-order' : value.startsWith('--max-count=') ? `--max-count=${limit + 1}` : value);
  const [statusText, branchText, logText, stashText, tagText, remotes, worktreeText, currentOperation, version] = await Promise.all([
    output(repo, ['status', '--porcelain=v1', '-z', '--branch', '--untracked-files=all']),
    output(repo, ['for-each-ref', '--sort=-committerdate', '--format=%(refname)%00%(HEAD)%00%(upstream:short)%00%(objectname)%00%(subject)%00%(symref)', 'refs/heads', 'refs/remotes']),
    output(repo, ['log', ...historyArgs, '--all', '--']),
    output(repo, ['stash', 'list', '--format=%gd%x00%H%x00%gs%x00%aI%x1e']),
    output(repo, ['for-each-ref', '--sort=-creatordate', '--format=%(refname:short)%00%(objectname)%00%(subject)', 'refs/tags']),
    remoteList(repo), output(repo, ['worktree', 'list', '--porcelain', '-z']), operation(repo), gitVersion(repo),
  ]);
  const commits = parseCommits(logText);
  return {
    root: repo, name: path.basename(repo), ...parseStatus(statusText), commits: commits.slice(0, limit),
    commitsHasMore: commits.length > limit, commitsOrder: 'topo',
    branches: parseBranches(branchText), stashes: parseStashes(stashText), tags: parseTags(tagText), remotes,
    worktrees: parseWorktrees(worktreeText), operation: currentOperation, gitVersion: version.trim(),
  };
}

function diffResult(text: string): DiffResult {
  const truncated = Buffer.byteLength(text) > MAX_DIFF;
  const binary = /(?:Binary files .* differ|GIT binary patch)/.test(text) && (text.match(/^diff --git /gm) || []).length <= 1;
  return { text: truncated ? text.slice(0, MAX_DIFF / 2) + '\n\n[差异内容过长，已截断显示]' : text, binary, truncated };
}

async function fileDiff(repo: string, request: GitQuery): Promise<DiffResult> {
  const selected = request.path ? await safePath(repo, request.path) : undefined;
  const diffFlags = ['--no-ext-diff', '--no-textconv', '--find-renames', '--no-color', '--unified=5'];
  if (request.base && request.ref) {
    const base = await output(repo, ['rev-parse', '--verify', '--end-of-options', `${ref(request.base)}^{tree}`]);
    const target = await commitRef(repo, request.ref);
    return diffResult(await output(repo, ['diff', ...diffFlags, base.trim(), target, '--', ...(selected ? [selected] : [])]));
  }
  if (request.ref) {
    const hash = await commitRef(repo, request.ref);
    return diffResult(await output(repo, ['show', '--format=', '--first-parent', ...diffFlags, hash, '--', ...(selected ? [selected] : [])]));
  }
  if (selected && !request.staged) {
    const tracked = await output(repo, ['ls-files', '-z', '--', selected]);
    if (!tracked) {
      const absolute = path.join(repo, selected);
      if (!(await exists(absolute))) return diffResult('');
      const stat = await fs.stat(absolute);
      if (!stat.isFile()) throw new Error('请选择普通文件查看差异。');
      if (stat.size > MAX_FILE) return { text: '文件超过 4 MB，请使用外部编辑器查看。', binary: false, truncated: true };
      const result = await run(repo, ['diff', '--no-index', '--no-ext-diff', '--no-textconv', '--no-color', '--', process.platform === 'win32' ? 'NUL' : '/dev/null', absolute], { allowCodes: [1] });
      return diffResult(result.stdout);
    }
  }
  return diffResult(await output(repo, ['diff', ...(request.staged ? ['--cached'] : []), ...diffFlags, '--', ...(selected ? [selected] : [])]));
}

async function commitDetail(repo: string, requested: string | undefined): Promise<CommitDetail> {
  const hash = await commitRef(repo, requested, 'HEAD');
  const [summary, body, stats, names, branchNames, hasCommit] = await Promise.all([
    output(repo, ['show', '-s', `--format=${COMMIT_FORMAT}`, hash, '--']),
    output(repo, ['show', '-s', '--format=%B', hash, '--']),
    output(repo, ['show', '--format=', '--first-parent', '--diff-merges=first-parent', '--numstat', '-z', '--find-renames', '--no-ext-diff', '--no-textconv', hash, '--']),
    output(repo, ['show', '--format=', '--first-parent', '--diff-merges=first-parent', '--name-status', '-z', '--find-renames', '--no-ext-diff', '--no-textconv', hash, '--']),
    output(repo, ['for-each-ref', `--contains=${hash}`, '--format=%(refname)', 'refs/heads', 'refs/remotes']),
    hasHead(repo),
  ]);
  const changes = new Map(parseNameChanges(names).map(file => [file.path, file]));
  const inCurrentBranch = hasCommit && (await run(repo, ['merge-base', '--is-ancestor', hash, 'HEAD'], { allowCodes: [1] })).code === 0;
  return {
    commit: parseCommits(summary)[0], body: body.trimEnd(), root: repo,
    branches: branchNames.split('\n').filter(Boolean).map(name => name.replace(/^refs\/(heads|remotes)\//, '')), inCurrentBranch,
    files: parseNumstat(stats).map(file => ({ ...file, ...(changes.get(file.path) || { status: 'M' }) })),
  };
}

export async function query(directory: string, request: GitQuery): Promise<unknown> {
  if (!request || typeof request !== 'object') throw new Error('查询参数不正确。');
  const repo = await rootOf(directory);
  await waitForMutation(repo);
  switch (request.type) {
    case 'snapshot': return snapshot(repo, request);
    case 'pushPreview': return pushPreview(repo, request.remote);
    case 'status': return workingState(repo);
    case 'log': return logHistory(repo, request.log);
    case 'resolveRef': return commitSummary(repo, request.ref);
    case 'logAuthors': {
      // 用原始作者字段分组，避免 shortlog 的默认 mailmap 名称与 --author 筛选不一致。
      const authors = await output(repo, ['shortlog', '-s', '--group=format:%an <%ae>', '--all']);
      return [...new Set(authors.split('\n').map(line => line.replace(/^\s*\d+\s+/, '').trim()).filter(Boolean))].sort((left, right) => left.localeCompare(right));
    }
    case 'tree': {
      if (!request.ref && !(await hasHead(repo))) return [];
      const hash = await commitRef(repo, request.ref, 'HEAD');
      const selected = request.path ? [await safePath(repo, request.path)] : [];
      const records = (await output(repo, ['ls-tree', '-r', '-l', '-z', '--full-tree', hash, '--', ...selected])).split('\0').filter(Boolean);
      if (records.length > 50_000) throw new Error('此版本包含超过 50000 个文件，请指定子目录缩小浏览范围。');
      return records.map(record => {
        const separator = record.indexOf('\t');
        const metadata = record.slice(0, separator).trim().split(/\s+/);
        return { path: record.slice(separator + 1), type: metadata[1], size: metadata[3] === '-' ? null : Number(metadata[3]) } as GitTreeEntry;
      });
    }
    case 'diff': return fileDiff(repo, request);
    case 'commit': return commitDetail(repo, request.ref);
    case 'compare': {
      const [from, to] = await Promise.all([commitRef(repo, request.ref, 'HEAD'), commitRef(repo, request.to, 'HEAD')]);
      const selected = request.path ? [await safePath(repo, request.path)] : [];
      return diffResult(await output(repo, ['diff', '--no-ext-diff', '--no-textconv', '--find-renames', '--no-color', from, to, '--', ...selected]));
    }
    case 'blame': {
      const selected = await safePath(repo, request.path);
      const revision = request.ref ? [await commitRef(repo, request.ref)] : [];
      return output(repo, ['blame', '--date=short', '-w', ...revision, '--', selected]);
    }
    case 'fileHistory': {
      const selected = await safePath(repo, request.path);
      if (!(await hasHead(repo))) return [];
      return parseCommits(await output(repo, ['log', ...logArgs(request), '--follow', ...(request.ref ? [await commitRef(repo, request.ref)] : []), '--', selected]));
    }
    case 'reflog': {
      if (!(await hasHead(repo))) return [];
      return parseCommits(await output(repo, ['reflog', 'show', `--max-count=${Math.min(500, Math.max(1, Math.floor(Number(request.limit) || 200)))}`, `--format=${COMMIT_FORMAT.replace('%s', '%gs').replace('%D', '%gd')}`, ref(request.ref, 'HEAD')]));
    }
    case 'submodules': return output(repo, ['submodule', 'status', '--recursive']);
    case 'fileContent': {
      const selected = await safePath(repo, request.path);
      if (request.ref || request.staged) {
        const spec = request.staged ? `:${selected}` : `${await commitRef(repo, request.ref)}:${selected}`;
        const size = Number((await output(repo, ['cat-file', '-s', spec])).trim());
        if (size > MAX_FILE) throw new Error('文件超过 4 MB，请使用外部编辑器查看。');
        const content = await output(repo, ['cat-file', 'blob', spec], { maxOutput: MAX_FILE + 1024, requireUtf8: true });
        if (content.includes('\0')) throw new Error('二进制文件不能使用文本编辑器打开。');
        return content;
      }
      const absolute = path.join(repo, selected);
      const stat = await fs.stat(absolute);
      if (!stat.isFile() || stat.size > MAX_FILE) throw new Error('只能打开不超过 4 MB 的普通文本文件。');
      const raw = await fs.readFile(absolute);
      if (!isUtf8(raw)) throw new Error('此文件不是有效的 UTF-8 文本，请使用支持原始编码的外部编辑器，避免保存时破坏内容。');
      const content = raw.toString('utf8');
      if (content.includes('\0')) throw new Error('二进制文件不能使用文本编辑器打开。');
      return content;
    }
    default: throw new Error('不支持的 Git 查询。');
  }
}

async function branchName(repo: string, value: unknown): Promise<string> {
  const name = ref(value);
  if (name.startsWith('refs/') || name.includes('@{') || name === 'HEAD') throw new Error('请输入普通分支名称。');
  await run(repo, ['check-ref-format', '--branch', name]);
  return name;
}

async function tagName(repo: string, value: unknown): Promise<string> {
  const name = ref(value);
  await run(repo, ['check-ref-format', `refs/tags/${name}`]);
  return name;
}

function remoteName(value: unknown, fallback = 'origin'): string {
  const name = required(value === '' || value === undefined || value === null ? fallback : value, '远端名称', 128).trim();
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(name)) throw new Error('远端名称仅支持字母、数字、点、横线和下划线。');
  return name;
}

async function knownRemote(repo: string, value: unknown): Promise<string> {
  const name = remoteName(value);
  if (!(await output(repo, ['remote'])).split('\n').includes(name)) throw new Error(`远端 ${name} 不存在，请先添加远端。`);
  return name;
}

function remoteUrl(value: unknown): string {
  const url = required(value, '远端地址', 8192).trim();
  if (/^https?:\/\/[^/@]*\*{3}[^/@]*@/i.test(url)) throw new Error('此地址包含隐藏的凭据占位符，请重新输入完整远端地址，或使用不含凭据的 URL。');
  if (url.startsWith('-') || /[\r\n\0]/.test(url) || url.includes('::')) throw new Error('远端地址不正确，不支持执行远端助手命令。');
  if (/^(https?|ssh|git):\/\//i.test(url) || /^[\w.-]+@[\w.-]+:[^\s]+$/.test(url) || path.isAbsolute(url)) return url;
  throw new Error('请输入 HTTPS、SSH 地址，或本地仓库的绝对路径。');
}

function stashRef(value: unknown): string {
  const result = required(value === '' || value === undefined || value === null ? 'stash@{0}' : value, '储藏引用', 100).trim();
  if (!/^stash@\{\d+\}$/.test(result)) throw new Error('请选择有效的储藏记录。');
  return result;
}

function selectedMode(value: unknown, allowed: string[], fallback: string): string {
  const mode = value === undefined || value === '' ? fallback : value;
  if (typeof mode !== 'string' || !allowed.includes(mode)) throw new Error('操作模式不正确。');
  return mode;
}

async function selectedFiles(repo: string, request: GitAction, filter?: 'staged' | 'unstaged'): Promise<string[]> {
  const hasExplicitPaths = request.paths !== undefined || !!request.path;
  // 显式文件已由调用方选择，只需已跟踪状态配对重命名，不必扫描其他未跟踪目录。
  const status = parseStatus(await output(repo, ['status', '--porcelain=v1', '-z', hasExplicitPaths ? '--untracked-files=no' : '--untracked-files=all']));
  const includePreviousPath = (file: typeof status.files[number]): boolean => !!file.oldPath
    && (request.type === 'commit' ? (file.index === 'R' || file.worktree === 'R') : request.type === 'stage' ? file.worktree === 'R'
      : (request.type === 'unstage' || (request.type === 'discard' && !!request.staged)) && file.index === 'R');
  if (hasExplicitPaths) {
    const explicit = await safePaths(repo, request.paths !== undefined ? request.paths : [request.path]);
    // Git 的 -z 重命名记录给出新旧路径，暂存区的两端必须一起处理。
    if (request.type === 'commit' || request.type === 'stage' || request.type === 'unstage' || (request.type === 'discard' && request.staged)) {
      const selected = new Set(explicit);
      const previousPaths = status.files.filter(file => includePreviousPath(file) && selected.has(file.path)).map(file => file.oldPath!).filter(value => !selected.has(value));
      return previousPaths.length ? [...new Set([...explicit, ...await safePaths(repo, previousPaths)])] : explicit;
    }
    return explicit;
  }
  const files = status.files.filter(file => (!filter || file[filter])
    && (request.type !== 'discard' || file.index !== '?') && (request.type !== 'stage' || !file.conflict));
  const paths = files.flatMap(file => includePreviousPath(file) ? [file.path, file.oldPath!] : [file.path]);
  if (!paths.length) throw new Error('没有可以操作的文件。');
  return safePaths(repo, paths);
}

async function trackedFiles(repo: string, files: string[]): Promise<void> {
  const index = await output(repo, ['ls-files', '--cached', '-z']);
  const committed = await hasHead(repo) ? await output(repo, ['ls-tree', '--name-only', '-r', '-z', 'HEAD']) : '';
  const tracked = [...new Set((index + committed).split('\0').filter(Boolean))];
  if (files.some(file => !tracked.some(item => item === file || item.startsWith(`${file}/`)))) {
    throw new Error('丢弃仅适用于已跟踪文件，未跟踪文件不会被删除。');
  }
}

function pathspecInput(files: string[]): string { return files.join('\0') + '\0'; }

async function runFiles(repo: string, args: string[], files: string[]): Promise<RunResult> {
  return run(repo, [...args, '--pathspec-from-file=-', '--pathspec-file-nul'], { input: pathspecInput(files) });
}

async function externalDirectory(value: unknown): Promise<string> {
  const original = required(value, '目录', 8192);
  if (!path.isAbsolute(original)) throw new Error('请选择绝对目录路径。');
  const target = path.resolve(original);
  if (path.parse(target).root === target || target.split(path.sep).some(segment => segment.toLowerCase() === '.git')) throw new Error('不能使用磁盘根目录或 .git 目录。');
  await noSymlink(target);
  return target;
}

async function ensureEmptyTarget(target: string): Promise<void> {
  if (await exists(target)) {
    if (!(await fs.stat(target)).isDirectory() || (await fs.readdir(target)).length > 0) throw new Error('目标目录必须不存在或为空目录。');
  }
}

async function revertFile(repo: string, request: GitAction): Promise<ActionResult> {
  const selected = await safePath(repo, request.path);
  const hash = await commitRef(repo, request.ref);
  if (await operation(repo)) throw new Error('请先完成或中止当前 Git 操作，再撤销历史文件改动。');
  const diffOptions = ['--format=', '--first-parent', '--diff-merges=first-parent', '--find-renames', '--no-ext-diff', '--no-textconv'];
  const names = await output(repo, ['show', ...diffOptions, '--name-status', '-z', hash, '--']);
  const change = parseNameChanges(names).find(file => file.path === selected);
  if (!change) throw new Error('所选文件不在该提交的改动列表中。');
  if (!/^[AMDR]\d*$/.test(change.status)) throw new Error('此类型的文件改动暂不支持安全撤销，请使用 Git 命令行处理。');
  const files = await safePaths(repo, [change.path, ...(change.oldPath ? [change.oldPath] : [])]);
  const status = parseStatus(await output(repo, ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--ignored=matching']));
  if (status.files.some(file => file.conflict)) throw new Error('仓库中仍有冲突，请先解决冲突。');
  const overlaps = (left: string, right: string) => {
    const normalize = (value: string) => process.platform === 'win32' ? value.toLowerCase() : value;
    const a = normalize(left); const b = normalize(right);
    return a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
  };
  if (status.files.some(file => files.some(selectedPath => overlaps(file.path.replace(/\/$/, ''), selectedPath) || (!!file.oldPath && overlaps(file.oldPath, selectedPath))))) {
    throw new Error('所选文件或重命名前路径存在未提交、未跟踪或忽略的本地内容，请先提交或储藏后再撤销。');
  }
  for (const file of files) {
    const absolute = path.join(repo, file);
    if (await exists(absolute)) {
      if (!(await fs.stat(absolute)).isFile()) throw new Error('只能撤销普通文件，不能覆盖目录。');
    }
  }
  const scoped = parseNameChanges(await output(repo, ['show', ...diffOptions, '--name-status', '-z', hash, '--', ...files]));
  if (scoped.length !== 1 || scoped[0].path !== change.path || scoped[0].oldPath !== change.oldPath) throw new Error('无法将此次变更安全限定为一个文件，请使用 Git 命令行处理。');
  const patch = await output(repo, ['show', ...diffOptions, '--binary', '--full-index', '--src-prefix=a/', '--dst-prefix=b/', hash, '--', ...files], { requireUtf8: true });
  if (!patch.trim()) throw new Error('该文件没有可撤销的补丁。');
  if (/^(?:old mode|new mode|new file mode|deleted file mode) (?:120000|160000)$/m.test(patch) || /^index [^\r\n]+ (?:120000|160000)$/m.test(patch)) {
    throw new Error('符号链接和子模块改动不能通过文件撤销功能修改。');
  }
  await run(repo, ['apply', '--reverse', '--check', '--whitespace=nowarn', '-'], { input: patch });
  await run(repo, ['apply', '--reverse', '--whitespace=nowarn', '-'], { input: patch });
  return { output: `已在工作区撤销 ${selected} 于 ${hash.slice(0, 8)} 的改动（合并提交相对首个父提交），请检查差异后自行暂存、提交。` };
}

export async function action(directory: string, request: GitAction): Promise<ActionResult> {
  if (!request || typeof request !== 'object') throw new Error('操作参数不正确。');
  const repo = await rootOf(directory);
  return serialized(repo, async () => {
    let result: RunResult | undefined;
    switch (request.type) {
      case 'stage': {
        result = await runFiles(repo, ['add', '--all'], await selectedFiles(repo, request, 'unstaged'));
        break;
      }
      case 'unstage': {
        const files = await selectedFiles(repo, request, 'staged');
        result = await hasHead(repo)
          ? await runFiles(repo, ['restore', '--staged'], files)
          : await runFiles(repo, ['rm', '--cached', '--force', '--ignore-unmatch'], files);
        break;
      }
      case 'commit': {
        const message = required(request.message, '提交说明', 50_000);
        const selected = request.paths ? await selectedFiles(repo, request) : undefined;
        if (selected && !selected.length) throw new Error('请选择要提交的文件。');
        if (selected) await runFiles(repo, ['add', '--all'], selected);
        result = await run(repo, ['commit', ...(selected ? ['--only'] : []), '--file=-', ...(request.amend ? ['--amend'] : []), ...(request.signoff ? ['--signoff'] : []), ...(selected ? ['--', ...selected] : [])], { input: message, timeout: NETWORK_TIMEOUT });
        break;
      }
      case 'fetch': {
        const mode = selectedMode(request.mode, ['default', 'prune'], 'default');
        const args = request.remote ? [await knownRemote(repo, request.remote)] : ['--all'];
        result = await run(repo, ['fetch', ...(mode === 'prune' ? ['--prune'] : []), ...args], { timeout: NETWORK_TIMEOUT });
        break;
      }
      case 'pull': {
        const mode = selectedMode(request.mode, ['ff-only', 'merge', 'rebase'], request.rebase ? 'rebase' : 'ff-only');
        const args = ['pull', ...(mode === 'merge' ? ['--no-rebase', '--ff', '--no-edit'] : mode === 'rebase' ? ['--rebase', '--ff'] : ['--ff-only'])];
        if (request.remote || request.ref) args.push(await knownRemote(repo, request.remote));
        if (request.ref) args.push(await branchName(repo, request.ref));
        result = await run(repo, args, { timeout: NETWORK_TIMEOUT });
        break;
      }
      case 'push': {
        if (request.expectedHead) {
          const current = await pushPreview(repo, request.remote);
          if (current.head !== request.expectedHead || current.branch !== request.ref || current.target !== request.name) throw new Error('待推送内容已变化，请刷新推送预览后重试。');
          if (!current.total) throw new Error('没有待推送的提交。');
          result = await run(repo, ['push', '--set-upstream', current.remote, `refs/heads/${current.branch}:refs/heads/${current.target}`], { timeout: NETWORK_TIMEOUT });
          break;
        }
        const mode = selectedMode(request.mode, ['default', 'set-upstream', 'tags'], 'default');
        const args = ['push', ...(request.force ? ['--force-with-lease'] : [])];
        if (mode === 'tags') {
          if (request.force) throw new Error('批量推送标签不支持强制覆盖，请逐个处理冲突标签。');
          args.push('--tags', await knownRemote(repo, request.remote));
        } else {
          const currentBranch = (await output(repo, ['symbolic-ref', '--quiet', '--short', 'HEAD'], { allowCodes: [1] })).trim();
          const selectedBranch = request.ref ? await branchName(repo, request.ref) : currentBranch;
          if (!selectedBranch) throw new Error('当前处于分离 HEAD 状态，请先选择要推送的本地分支。');
          const upstream = (await run(repo, ['rev-parse', '--abbrev-ref', `${selectedBranch}@{upstream}`], { allowCodes: [128] })).code === 0;
          if (mode === 'set-upstream' || !upstream) args.push('--set-upstream');
          if (request.remote || request.ref || mode === 'set-upstream' || !upstream) args.push(await knownRemote(repo, request.remote), selectedBranch);
        }
        result = await run(repo, args, { timeout: NETWORK_TIMEOUT });
        break;
      }
      case 'switch': {
        const name = ref(request.ref ?? request.name);
        await commitRef(repo, name);
        const branches = parseBranches(await output(repo, ['for-each-ref', '--format=%(refname)%00%(HEAD)%00%(upstream:short)%00%(objectname)%00%(subject)%00%(symref)', 'refs/heads', 'refs/remotes']));
        const branch = branches.find(entry => entry.name === name);
        result = branch?.remote
          ? await run(repo, ['switch', '--track', '--', name])
          : branch ? await run(repo, ['switch', '--', name]) : await run(repo, ['switch', '--detach', await commitRef(repo, name)]);
        break;
      }
      case 'branchCreate': {
        const name = await branchName(repo, request.name);
        const args = ['branch', name];
        if (request.ref) args.push(await commitRef(repo, request.ref));
        result = await run(repo, args);
        break;
      }
      case 'branchRename': {
        const name = await branchName(repo, request.name);
        result = await run(repo, ['branch', '-m', ...(request.ref ? [await branchName(repo, request.ref)] : []), name]);
        break;
      }
      case 'branchDelete': {
        const name = await branchName(repo, request.ref ?? request.name);
        result = await run(repo, ['branch', request.force ? '-D' : '-d', name]);
        break;
      }
      case 'merge': {
        const mode = selectedMode(request.mode, ['ff', 'no-ff', 'ff-only', 'squash'], 'ff');
        result = await run(repo, ['merge', '--no-edit', `--${mode}`, await commitRef(repo, request.ref)], { timeout: NETWORK_TIMEOUT });
        break;
      }
      case 'rebase': result = await run(repo, ['rebase', await commitRef(repo, request.ref)], { timeout: NETWORK_TIMEOUT }); break;
      case 'cherryPick': result = await run(repo, ['cherry-pick', await commitRef(repo, request.ref)], { timeout: NETWORK_TIMEOUT }); break;
      case 'revert': result = await run(repo, ['revert', '--no-edit', await commitRef(repo, request.ref)], { timeout: NETWORK_TIMEOUT }); break;
      case 'revertFile': return revertFile(repo, request);
      case 'writeCommitGraph': {
        await run(repo, ['commit-graph', 'write', '--reachable', '--changed-paths'], { timeout: NETWORK_TIMEOUT });
        return { output: '已生成 Git 原生 commit-graph 与路径布隆过滤器，用于加速提交和文件历史查询；这不是 IDEA 专用的日志索引。' };
      }
      case 'reset': {
        const mode = selectedMode(request.mode, ['soft', 'mixed', 'hard'], 'mixed');
        result = await run(repo, ['reset', `--${mode}`, await commitRef(repo, request.ref, 'HEAD')]);
        break;
      }
      case 'stashSave': {
        const args = ['stash', 'push', ...(request.includeUntracked ? ['--include-untracked'] : [])];
        if (request.message?.trim()) args.push('--message', required(request.message, '储藏说明', 10_000));
        result = request.paths !== undefined ? await runFiles(repo, args, await safePaths(repo, request.paths)) : await run(repo, args);
        break;
      }
      case 'stashApply': result = await run(repo, ['stash', 'apply', stashRef(request.ref)]); break;
      case 'stashPop': result = await run(repo, ['stash', 'pop', stashRef(request.ref)]); break;
      case 'stashDrop': result = await run(repo, ['stash', 'drop', stashRef(request.ref)]); break;
      case 'tagCreate': {
        const name = await tagName(repo, request.name);
        const args = ['tag'];
        if (request.message?.trim()) args.push('--annotate', '--message', required(request.message, '标签说明', 10_000));
        args.push(name, await commitRef(repo, request.ref, 'HEAD'));
        result = await run(repo, args);
        break;
      }
      case 'tagDelete': result = await run(repo, ['tag', '--delete', await tagName(repo, request.name ?? request.ref)]); break;
      case 'remoteAdd': result = await run(repo, ['remote', 'add', remoteName(request.name), remoteUrl(request.url)]); break;
      case 'remoteRemove': result = await run(repo, ['remote', 'remove', await knownRemote(repo, request.remote ?? request.name)]); break;
      case 'remoteSetUrl': result = await run(repo, ['remote', 'set-url', await knownRemote(repo, request.remote ?? request.name), remoteUrl(request.url)]); break;
      case 'discard': {
        const files = await selectedFiles(repo, request, request.staged ? undefined : 'unstaged');
        await trackedFiles(repo, files);
        result = await runFiles(repo, ['restore', '--worktree', ...(request.staged ? ['--staged', '--source=HEAD'] : [])], files);
        break;
      }
      case 'resolve': {
        const files = await selectedFiles(repo, request);
        const mode = selectedMode(request.mode, ['ours', 'theirs', 'mark'], 'mark');
        const conflicts = parseStatus(await output(repo, ['status', '--porcelain=v1', '-z'])).files.filter(file => file.conflict);
        if (files.some(file => !conflicts.some(conflict => conflict.path === file))) throw new Error('只能对当前冲突文件执行解决操作。');
        if (mode === 'mark') {
          result = await runFiles(repo, ['add', '--all'], files);
        } else {
          const side = mode === 'ours' ? '2' : '3';
          const entries = (await output(repo, ['ls-files', '--unmerged', '-z'])).split('\0');
          const available = new Set(entries.filter(entry => entry.slice(0, entry.indexOf('\t')).endsWith(` ${side}`)).map(entry => entry.slice(entry.indexOf('\t') + 1)));
          const restored = files.filter(file => available.has(file));
          const removed = files.filter(file => !available.has(file));
          if (restored.length) {
            await runFiles(repo, ['restore', '--worktree', `--${mode}`], restored);
            result = await runFiles(repo, ['add', '--all'], restored);
          }
          // 删除/修改冲突中，所选一侧可能正是“删除该文件”。
          if (removed.length) result = await runFiles(repo, ['rm', '--force'], removed);
        }
        break;
      }
      case 'continue':
      case 'abort':
      case 'skip': {
        const current = await operation(repo);
        if (!['merge', 'rebase', 'cherry-pick', 'revert', 'am'].includes(current)) throw new Error('当前没有可继续、终止或跳过的 Git 操作。');
        if (request.type === 'skip' && current === 'merge') throw new Error('合并操作不能跳过，请继续或终止。');
        result = await run(repo, [current, `--${request.type}`], { timeout: NETWORK_TIMEOUT });
        break;
      }
      case 'applyPatch': {
        const mode = selectedMode(request.mode, ['worktree', 'index', 'reverse'], request.staged ? 'index' : 'worktree');
        let content = request.content;
        if (!content) {
          const selected = await safePath(repo, request.path);
          const stat = await fs.stat(path.join(repo, selected));
          if (!stat.isFile() || stat.size > MAX_FILE) throw new Error('补丁文件必须小于 4 MB。');
          const raw = await fs.readFile(path.join(repo, selected));
          if (!isUtf8(raw)) throw new Error('补丁文件必须使用 UTF-8 编码，请先用外部编辑器检查原始编码。');
          content = raw.toString('utf8');
        }
        content = required(content, '补丁内容', MAX_FILE);
        const flags = mode === 'index' ? ['--index'] : mode === 'reverse' ? ['--reverse'] : [];
        const stats = await output(repo, ['apply', '--numstat', '-z', ...flags, '-'], { input: content });
        const patchPaths = parseNumstat(stats).map(file => file.path);
        if (!patchPaths.length) throw new Error('补丁中没有可应用的文件。');
        await safePaths(repo, patchPaths);
        await run(repo, ['apply', '--check', ...flags, '-'], { input: content });
        result = await run(repo, ['apply', ...flags, '-'], { input: content });
        break;
      }
      case 'ignore': {
        const files = await selectedFiles(repo, request);
        if (files.some(file => /[\r\n]/.test(file))) throw new Error('文件名中包含换行，无法生成可靠的忽略规则。');
        const ignoreFile = await safePath(repo, '.gitignore');
        const absolute = path.join(repo, ignoreFile);
        let original = '';
        try {
          const stat = await fs.stat(absolute);
          if (!stat.isFile() || stat.size > MAX_FILE) throw new Error('.gitignore 超过 4 MB 或不是普通文件，请使用外部编辑器修改。');
          const raw = await fs.readFile(absolute);
          if (!isUtf8(raw)) throw new Error('.gitignore 不是 UTF-8 编码，请使用外部编辑器修改以免破坏原内容。');
          original = raw.toString('utf8');
        } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
        const patterns = files.map(file => '/' + file.replace(/[\\*?\[\]#! ]/g, '\\$&'));
        const existing = new Set(original.split(/\r?\n/));
        const added = patterns.filter(pattern => !existing.has(pattern));
        if (added.length) await fs.writeFile(absolute, original + (original && !original.endsWith('\n') ? '\n' : '') + added.join('\n') + '\n', 'utf8');
        return { output: added.length ? `已向 .gitignore 添加 ${added.length} 条规则。已跟踪文件仍由 Git 管理。` : '忽略规则已存在。' };
      }
      case 'worktreeAdd': {
        const target = await externalDirectory(request.path);
        if (pathInside(repo, target) || pathInside(target, repo)) throw new Error('工作树目录必须位于当前仓库之外。');
        await ensureEmptyTarget(target);
        const args = ['worktree', 'add'];
        if (request.name) args.push('-b', await branchName(repo, request.name));
        args.push('--', target);
        if (request.ref) args.push(ref(request.ref));
        result = await run(repo, args);
        break;
      }
      case 'worktreeRemove': {
        const target = await externalDirectory(request.path);
        const trees = parseWorktrees(await output(repo, ['worktree', 'list', '--porcelain', '-z']));
        const key = (value: string) => process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value);
        if (!trees.some(tree => key(tree.path) === key(target)) || key(repo) === key(target)) throw new Error('只能移除当前仓库已登记的其他工作树。');
        result = await run(repo, ['worktree', 'remove', '--', target]);
        break;
      }
      case 'submoduleUpdate': result = await run(repo, ['submodule', 'update', '--init', '--recursive'], { timeout: NETWORK_TIMEOUT }); break;
      case 'saveFile': {
        const selected = await safePath(repo, request.path);
        if (typeof request.content !== 'string' || Buffer.byteLength(request.content) > MAX_FILE || request.content.includes('\0')) throw new Error('只能保存不超过 4 MB 的普通文本内容。');
        const absolute = path.join(repo, selected);
        const stat = await fs.stat(absolute);
        if (!stat.isFile()) throw new Error('只能编辑已有普通文件。');
        await fs.writeFile(absolute, request.content, 'utf8');
        return { output: `已保存 ${selected}` };
      }
      default: throw new Error('不支持的 Git 操作。');
    }
    return { output: cleanError([result?.stdout, result?.stderr].filter(Boolean).join('\n')) || '操作完成。' };
  });
}

export async function openRepository(directory: string): Promise<RepoEntry> {
  const repo = await rootOf(directory);
  return { path: repo, name: path.basename(repo), lastOpened: new Date().toISOString() };
}

export async function cloneRepository(url: string, parent: string, name?: string): Promise<RepoEntry> {
  const source = remoteUrl(url);
  const parentPath = await externalDirectory(parent);
  if (!(await fs.stat(parentPath)).isDirectory()) throw new Error('请选择有效的父目录。');
  const folder = name?.trim() || source.replace(/[\\/]$/, '').split(/[/:]/).pop()?.replace(/\.git$/, '') || 'repository';
  if (!/^[^<>:"/\\|?*\x00-\x1f]+$/.test(folder) || folder === '.' || folder === '..' || /[. ]$/.test(folder) || folder.toLowerCase() === '.git') throw new Error('仓库目录名称不正确。');
  const target = path.join(parentPath, folder);
  await noSymlink(target);
  await ensureEmptyTarget(target);
  return serialized(target, async () => {
    await run(parentPath, ['clone', '--progress', '--', source, target], { timeout: NETWORK_TIMEOUT });
    return openRepository(target);
  });
}

export async function initRepository(directory: string): Promise<RepoEntry> {
  const target = await externalDirectory(directory);
  if (await exists(path.join(target, '.git'))) throw new Error('该目录已经是 Git 仓库，请直接打开。');
  return serialized(target, async () => {
    await fs.mkdir(target, { recursive: true });
    await run(target, ['init']);
    return openRepository(target);
  });
}

export async function exportPatch(directory: string, requested?: string): Promise<string> {
  const repo = await rootOf(directory);
  await waitForMutation(repo);
  if (requested) return output(repo, ['format-patch', '-1', '--stdout', '--binary', '--no-ext-diff', '--no-textconv', await commitRef(repo, requested)]);
  const args = ['diff', '--binary', '--no-ext-diff', '--no-textconv', '--no-color'];
  if (await hasHead(repo)) args.push('HEAD');
  else args.push('--cached');
  args.push('--');
  return output(repo, args);
}

async function pushPreview(repo: string, requestedRemote?: string): Promise<PushPreview> {
  const branch = (await output(repo, ['symbolic-ref', '--quiet', '--short', 'HEAD'], { allowCodes: [1] })).trim();
  if (!branch) throw new Error('请先切换到本地分支再推送。');
  const tracking = (await output(repo, ['for-each-ref', '--format=%(upstream:remotename)%00%(upstream:remoteref)', 'refs/heads/' + branch])).trim().split('\0');
  const remotes = (await output(repo, ['remote'])).trim().split('\n').filter(Boolean);
  const remote = await knownRemote(repo, requestedRemote || (remotes.includes(tracking[0]) ? tracking[0] : remotes.includes('origin') ? 'origin' : remotes[0]));
  const target = remote === tracking[0] && tracking[1]?.startsWith('refs/heads/') ? tracking[1].slice(11) : branch;
  await branchName(repo, target);
  const head = await commitRef(repo, 'HEAD');
  const remoteRef = await run(repo, ['rev-parse', '--verify', '--quiet', '--end-of-options', 'refs/remotes/' + remote + '/' + target], { allowCodes: [1,128] });
  const base = remoteRef.code === 0 ? remoteRef.stdout.trim() : (await output(repo, ['hash-object', '-t', 'tree', '--stdin'], { input: '' })).trim();
  const revisions = remoteRef.code === 0 ? [base + '..' + head] : [head];
  const [log, names, count] = await Promise.all([
    output(repo, ['log', '--max-count=500', '--topo-order', '--format=' + COMMIT_FORMAT, ...revisions, '--']),
    output(repo, ['diff', '--name-status', '-z', '--find-renames', '--no-ext-diff', '--no-textconv', base, head, '--']),
    output(repo, ['rev-list', '--count', ...revisions, '--']),
  ]);
  return { branch, remote, target, head, base, commits: parseCommits(log), files: parseNameChanges(names), total: Number(count.trim()) };
}
