import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowDownToLine, ArrowLeftRight, ArrowUp, ArrowUpRight, Check, CheckCheck, ChevronDown, ChevronRight, Circle, Clock3, Code2, Command, Copy, FileCode2, FileDiff, FilePlus2, FileWarning, Files, FolderGit2, FolderOpen, GitBranch, GitCommitHorizontal, GitCompareArrows, GitFork, GitMerge, History, Layers3, ListFilter, Loader2, Maximize2, Minus, Moon, MoreHorizontal, PanelLeftClose, PanelLeftOpen, Plus, RefreshCw, Search, Settings2, ShieldCheck, SquareTerminal, Sun, Tag, Trash2, Upload, X } from 'lucide-react';
import type { AppLanguage, AppSettings, AppTheme, CommitDetail, DiffResult, GitAction, GitActionType, GitCommit, GitFile, GitQuery, GitSnapshot, GitWorkingState, GitTreeEntry, PushPreview, RepoEntry } from '../shared/types';
import { DEFAULT_PREFERENCES } from '../shared/types';
import SettingsDialog, { THEMES } from './components/SettingsDialog';
import SelectMenu from './components/SelectMenu';
import LogPanel, { type LogCommand } from './components/LogPanel';
import CommitDetails from './components/CommitDetails';
import { ChevronsDownUp, ChevronsUpDown, Eye, PanelRightClose, PanelRightOpen, Undo2 } from 'lucide-react';
import ResizeHandle from './components/ResizeHandle';
import DiffViewer from './components/DiffViewer';
import CodeViewer from './components/CodeViewer';
import FileTree from './components/FileTree';
import FileIcon from './components/FileIcon';
import { fileStatusClass } from './lib/file-presentation';
import { I18nProvider, useI18n, type Translate } from './lib/i18n';
import { clamp, usePanelSize } from './lib/panel-preferences';
import { RotateCcw, WrapText } from 'lucide-react';
import RepositoryDialog from './components/RepositoryDialog';
import WorkspacePanel, { type WorkspaceCommand } from './components/WorkspacePanel';
import { Minimize2, Languages } from 'lucide-react';
import type { DesktopState } from '../shared/types';
import './styles.css';
import './workbench-layout.css';

type Selection = { kind: 'commit'; hash: string; path?: string } | { kind: 'file'; path: string; staged: boolean };
type ToolKind = GitActionType | 'compare' | 'blame' | 'fileHistory' | 'reflog' | 'submodules' | 'exportPatch' | 'conflictEditor';
type Field = { key: string; label: string; placeholder?: string; type?: 'area' | 'check' | 'select'; options?: string[]; required?: boolean };
type ToolSpec = { id: ToolKind; label: string; group: string; hint: string; fields: Field[]; query?: boolean; danger?: boolean };
const F = (key: string, label: string, placeholder = '', required = false): Field => ({ key, label, placeholder, required });
const TOOLS: ToolSpec[] = [
  { id: 'branchCreate', label: '新建分支', group: '分支', hint: '从指定提交或分支创建新分支。', fields: [F('name', '分支名称', 'feature/my-feature', true), F('ref', '起点', 'HEAD')] },
  { id: 'switch', label: '切换分支', group: '分支', hint: '切换到已有的本地分支或远端跟踪分支。', fields: [F('ref', '分支', '分支名称', true)] },
  { id: 'branchRename', label: '重命名分支', group: '分支', hint: '为本地分支设置一个新名称。', fields: [F('ref', '原分支名称', '当前分支'), F('name', '新名称', '', true)] },
  { id: 'branchDelete', label: '删除分支', group: '分支', hint: '删除本地分支；强制删除会跳过未合并检查。', fields: [F('ref', '分支名称', '', true), { key: 'force', label: '强制删除未合并分支', type: 'check' }], danger: true },
  { id: 'merge', label: '合并分支', group: '集成', hint: '将目标分支合并到当前分支。冲突可在变更列表中解决。', fields: [F('ref', '合并来源', '', true), { key: 'mode', label: '合并模式', type: 'select', options: ['ff', 'no-ff', 'ff-only', 'squash'] }] },
  { id: 'rebase', label: '变基', group: '集成', hint: '将当前分支的提交重放到目标分支之上。变基会改写提交历史。', fields: [F('ref', '新的基线', 'origin/main', true)], danger: true },
  { id: 'cherryPick', label: '拣选提交', group: '集成', hint: '将指定提交的变更应用到当前分支。', fields: [F('ref', '提交哈希', '', true)] },
  { id: 'revert', label: '还原提交', group: '集成', hint: '创建一个反向提交，保留已有历史。', fields: [F('ref', '提交哈希', '', true)] },
  { id: 'revertFile', label: '反向撤销文件改动', group: '集成', hint: '只反向应用该历史提交对所选文件的改动到当前工作区；不会自动暂存或提交。合并提交以第一个父提交为基准；文件有本地改动时将拒绝。', fields: [F('ref', '历史提交', '', true), F('path', '文件相对路径', '', true)], danger: true },
  { id: 'writeCommitGraph', label: '加速日志查询', group: '查看', hint: '生成 Git 原生 commit-graph 缓存以加速历史遍历；这不是 IDEA 的日志索引，不改变提交或分支。', fields: [] },
  { id: 'reset', label: '重置 HEAD', group: '集成', hint: 'soft 保留暂存区；mixed 保留工作区；hard 丢弃对应本地改动。', fields: [F('ref', '目标提交', 'HEAD~1', true), { key: 'mode', label: '重置模式', type: 'select', options: ['soft', 'mixed', 'hard'] }], danger: true },
  { id: 'continue', label: '继续当前操作', group: '集成', hint: '解决并暂存冲突后，继续当前合并、变基或拣选。', fields: [] },
  { id: 'abort', label: '中止当前操作', group: '集成', hint: '中止正在进行的合并、变基、拣选或还原。', fields: [], danger: true },
  { id: 'skip', label: '跳过当前提交', group: '集成', hint: '跳过当前变基或拣选中的提交。', fields: [] },
  { id: 'stashSave', label: '暂存到 Stash', group: '暂存', hint: '保存当前未提交的改动，稍后恢复。', fields: [F('message', '说明', '正在进行的工作'), { key: 'includeUntracked', label: '包含未跟踪文件', type: 'check' }] },
  { id: 'stashApply', label: '应用 Stash', group: '暂存', hint: '恢复保存的改动，并保留 Stash 条目。', fields: [F('ref', 'Stash', 'stash@{0}')] },
  { id: 'stashPop', label: '弹出 Stash', group: '暂存', hint: '恢复保存的改动，成功后移除对应 Stash 条目。', fields: [F('ref', 'Stash', 'stash@{0}')] },
  { id: 'stashDrop', label: '删除 Stash', group: '暂存', hint: '移除保存的 Stash 条目。', fields: [F('ref', 'Stash', 'stash@{0}')], danger: true },
  { id: 'tagCreate', label: '新建标签', group: '标签', hint: '给指定提交添加标签，填写说明可创建附注标签。', fields: [F('name', '标签名称', 'v1.0.0', true), F('ref', '目标提交', 'HEAD'), F('message', '标签说明', '可选')] },
  { id: 'tagDelete', label: '删除本地标签', group: '标签', hint: '删除仓库中的本地标签。', fields: [F('name', '标签名称', '', true)], danger: true },
  { id: 'fetch', label: '获取远端', group: '远端', hint: '获取远端分支的最新提交。', fields: [F('remote', '远端', '留空获取全部远端'), { key: 'mode', label: '获取模式', type: 'select', options: ['default', 'prune'] }] },
  { id: 'pull', label: '拉取更新', group: '远端', hint: '从远端拉取并集成到当前分支。', fields: [F('remote', '远端', 'origin'), { key: 'mode', label: '拉取策略', type: 'select', options: ['ff-only', 'merge', 'rebase'] }] },
  { id: 'push', label: '推送提交', group: '远端', hint: '将当前分支推送到远端。强制推送使用 force-with-lease。', fields: [F('remote', '远端', 'origin'), { key: 'mode', label: '推送模式', type: 'select', options: ['default', 'set-upstream', 'tags'] }, { key: 'force', label: '安全强制推送（force-with-lease）', type: 'check' }] },
  { id: 'remoteAdd', label: '添加远端', group: '远端', hint: '添加一个远程仓库地址。', fields: [F('name', '远端名称', 'origin', true), F('url', '仓库地址', 'https://… / git@…', true)] },
  { id: 'remoteSetUrl', label: '修改远端地址', group: '远端', hint: '更新指定远端的仓库地址。', fields: [F('name', '远端名称', 'origin', true), F('url', '新地址', '输入完整仓库地址（含掩码地址不可直接保存）', true)] },
  { id: 'remoteRemove', label: '移除远端', group: '远端', hint: '移除本地远端配置及其跟踪引用。', fields: [F('name', '远端名称', 'origin', true)], danger: true },
  { id: 'compare', label: '比较引用', group: '查看', hint: '比较两个分支、标签或提交之间的文件变化。', fields: [F('ref', '比较起点', 'main', true), F('to', '比较终点', 'HEAD', true)], query: true },
  { id: 'blame', label: '逐行追溯', group: '查看', hint: '查看文件每一行的最后修改者与对应提交。', fields: [F('path', '文件相对路径', 'src/App.tsx', true), F('ref', '引用', 'HEAD')], query: true },
  { id: 'fileHistory', label: '文件历史', group: '查看', hint: '追踪文件的提交记录与重命名历史。', fields: [F('path', '文件相对路径', '', true), F('ref', '截至提交（可选）', 'HEAD')], query: true },
  { id: 'reflog', label: '引用日志', group: '查看', hint: '查看本地 HEAD 的移动记录，定位重置或变基前的提交。', fields: [], query: true },
  { id: 'exportPatch', label: '导出补丁', group: '补丁', hint: '导出指定提交或工作区差异到补丁文件。', fields: [F('ref', '提交', '留空导出工作区差异')] },
  { id: 'applyPatch', label: '应用补丁', group: '补丁', hint: '将补丁内容应用到当前工作区。', fields: [{ key: 'content', label: '补丁内容', type: 'area', placeholder: '粘贴 diff / patch 内容', required: true }, { key: 'staged', label: '同时更新暂存区', type: 'check' }] },
  { id: 'resolve', label: '选择冲突版本', group: '工作区', hint: 'ours / theirs 选用对应侧并暂存；手动编辑后选择 mark 标记已解决。变基时两侧含义由 Git 决定。', fields: [F('path', '冲突文件', '', true), { key: 'mode', label: '采用版本', type: 'select', options: ['ours', 'theirs', 'mark'] }] },
  { id: 'conflictEditor', label: '编辑冲突文件', group: '工作区', hint: '加载完整工作区文件，手动解决冲突后保存，再将文件暂存。', fields: [F('path', '文件相对路径', '', true)], query: true },
  { id: 'ignore', label: '添加忽略规则', group: '工作区', hint: '将规则追加到仓库根目录的 .gitignore。', fields: [F('path', '文件或目录相对路径', 'build/', true)] },
  { id: 'discard', label: '丢弃本地更改', group: '工作区', hint: '将已跟踪文件恢复到暂存区版本，仅丢弃未暂存更改；未跟踪文件不会删除。', fields: [F('path', '文件相对路径', '', true)], danger: true },
  { id: 'worktreeAdd', label: '添加工作树', group: '工作树', hint: '在另一个目录检出分支，以便并行开发。', fields: [F('path', '工作树目录', 'D:/Projects/feature', true), F('ref', '现有分支或提交', 'HEAD'), F('name', '创建新分支（可选）', 'feature/new')] },
  { id: 'worktreeRemove', label: '移除工作树', group: '工作树', hint: '移除指定工作树目录与其注册信息。', fields: [F('path', '工作树目录', '', true)], danger: true },
  { id: 'submodules', label: '查看子模块', group: '子模块', hint: '查看子模块的提交、路径与检出状态。', fields: [], query: true },
  { id: 'submoduleUpdate', label: '更新子模块', group: '子模块', hint: '初始化并递归更新仓库中的子模块。', fields: [] },
];

function shortDate(value: string, locale: string) { const d = new Date(value); return Number.isNaN(d.getTime()) ? value : d.toLocaleString(locale, { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }); }
function readPanelPreference(key: string, fallback: boolean) { try { const value = localStorage.getItem(`gitvista.${key}`); return value === 'true' ? true : value === 'false' ? false : fallback; } catch { return fallback; } }
function basename(path: string) { return path.split(/[\\/]/).pop() || path; }
function workingFileStatus(file: GitFile, staged?: boolean) {
  if (file.conflict) return 'U';
  const status = staged === undefined ? file.index + file.worktree : staged ? file.index : file.worktree;
  if (file.index === '?' || status.includes('?')) return 'A';
  return ['D', 'A', 'R', 'C', 'T', 'M'].find(value => status.includes(value)) || '';
}
function statusName(t: Translate, file: GitFile, staged?: boolean) { const status = workingFileStatus(file, staged); return status === 'U' ? t('冲突') : status === 'A' ? t('新增') : status === 'D' ? t('删除') : status === 'R' ? t('重命名') : t('修改'); }

function ErrorText(error: unknown) { return error instanceof Error ? error.message : String(error); }

/**
 * 这些情况不是失败，而是「这个文件没法用内置查看器读」。
 * 它们不该以红色报错占据顶部，而是在内容区给出温和的说明。
 * 同时匹配中英文，因为主进程的错误文本会随界面语言切换。
 */
const SOFT_NOTICE_PATTERNS = [
  '不是有效的 UTF-8', 'not valid UTF-8', 'not valid utf-8',
  '二进制文件不能使用文本编辑器', 'Binary files cannot be opened',
  '文件超过 4 MB', 'larger than 4 MB',
];
function isSoftNotice(message: string): boolean { return SOFT_NOTICE_PATTERNS.some(pattern => message.includes(pattern)); }
/** 读取内容失败时选择展示方式：温和提示，还是常规错误横幅。 */
function contentError(path: string, repo: string, error: unknown): { path: string; message: string; repo: string } | { banner: string } {
  const message = ErrorText(error);
  return isSoftNotice(message) ? { path, message, repo } : { banner: message };
}
function IconButton({ title, children, onClick, disabled, className = '' }: { title: string; children: React.ReactNode; onClick?: () => void; disabled?: boolean; className?: string }) { return <button type="button" title={title} aria-label={title} className={`icon-button ${className}`} onClick={onClick} disabled={disabled}>{children}</button>; }
function Empty({ title, detail, icon = <GitCommitHorizontal size={30} /> }: { title: string; detail?: string; icon?: React.ReactNode }) { return <div className="empty-state"><div className="empty-icon">{icon}</div><strong>{title}</strong>{detail && <p>{detail}</p>}</div>; }

/**
 * 语言偏好需要异步读取，因此由外层持有并驱动 I18nProvider；
 * 读取完成前用英文渲染，避免中文用户看到一次语言闪烁。
 */
export default function App() {
  const [language, setLanguage] = useState<AppLanguage>('en');
  useEffect(() => {
    let alive = true;
    const accept = (state: DesktopState) => { if (!alive || !state) return; setLanguage(state.language); };
    const unsubscribe = window.gitvista.onDesktopState(accept);
    void window.gitvista.desktopState().then(accept);
    void window.gitvista.settings().then(value => { if (alive) setLanguage(value.language); });
    return () => { alive = false; unsubscribe(); };
  }, []);
  return <I18nProvider language={language}><div className="workbench-host"><Workbench onLanguageChange={setLanguage} /></div></I18nProvider>;
}

function Workbench({ onLanguageChange }: { onLanguageChange: (language: AppLanguage) => void }) {
  const { t, locale } = useI18n();
  const [settings, setSettings] = useState<AppSettings>({ ...DEFAULT_PREFERENCES, repos: [] });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [workspaceEntry, setWorkspaceEntry] = useState<RepoEntry>();
  const [workspaceReturn, setWorkspaceReturn] = useState<RepoEntry>();
  const workspaceSelection = useRef(workspaceEntry); workspaceSelection.current = workspaceEntry;
  const [workspaceCommand, setWorkspaceCommand] = useState<WorkspaceCommand>();
  const requestWorkspace = (type: WorkspaceCommand['type']) => setWorkspaceCommand(current => ({ type, id: (current?.id || 0) + 1 }));
  const [repo, setRepo] = useState(''); const [snapshot, setSnapshot] = useState<GitSnapshot | null>(null);
  const [busy, setBusy] = useState(''); const [loading, setLoading] = useState(false); const [error, setError] = useState('');
  // 无法用内置查看器读取的文件（非 UTF-8、二进制、过大）单独保存，用于温和提示。
  const [noticeFile, setNoticeFile] = useState<{ path: string; message: string; repo: string } | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null); const [detail, setDetail] = useState<CommitDetail | null>(null); const [diff, setDiff] = useState<DiffResult | null>(null); const [diffLoading, setDiffLoading] = useState(false);
  const [branchFilter, setBranchFilter] = useState(''); const [split, setSplit] = useState(DEFAULT_PREFERENCES.diffView === 'split'); const [sidebar, setSidebar] = useState(() => readPanelPreference('dockOpen', false));
  const [dockTab, setDockTab] = useState<'repositories' | 'changes'>(() => { try { return localStorage.getItem('gitvista.dockTab') === 'repositories' ? 'repositories' : 'changes'; } catch { return 'changes'; } });
  const toggleDock = (tab: 'repositories' | 'changes') => { setSidebar(current => dockTab === tab ? !current : true); setDockTab(tab); };
  // 提交历史与本地变更是两扇独立的工具窗口：各自点开、再点收回。
  const [historyOpen, setHistoryOpen] = useState(() => readPanelPreference('historyDockOpen', true));
  useEffect(() => { try { localStorage.setItem('gitvista.dockOpen', String(sidebar)); localStorage.setItem('gitvista.dockTab', dockTab); localStorage.setItem('gitvista.historyDockOpen', String(historyOpen)); } catch {} }, [sidebar, dockTab, historyOpen]);
  const [message, setMessage] = useState(''); const [amend, setAmend] = useState(false); const [signoff, setSignoff] = useState(false);
  const [tool, setTool] = useState<ToolKind | null>(null); const [toolValues, setToolValues] = useState<Record<string, string | boolean>>({}); const [toolSearch, setToolSearch] = useState('');
  const [result, setResult] = useState<{ title: string; text?: string; diff?: DiffResult; commits?: GitCommit[]; editPath?: string; repo?: string } | null>(null);
  const [cloneOpen, setCloneOpen] = useState(false); const [credentialsOpen, setCredentialsOpen] = useState(false);
  const [pushOpen, setPushOpen] = useState(false); const [pushPreview, setPushPreview] = useState<PushPreview | null>(null); const [pushLoading, setPushLoading] = useState(false); const [pushError, setPushError] = useState('');
  const [pushDiff, setPushDiff] = useState<{ path: string; diff: DiffResult | null; loading: boolean } | null>(null);
  const [output, setOutput] = useState(''); const [notice, setNotice] = useState(''); const [more, setMore] = useState(false); const [limit, setLimit] = useState(250);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [codeMode, setCodeMode] = useState(false); const [code, setCode] = useState<string | null>(null); const [codeLoading, setCodeLoading] = useState(false); const [allFiles, setAllFiles] = useState(false); const [treeEntries, setTreeEntries] = useState<GitTreeEntry[]>([]);
  const [sideWidth, setSideWidth] = usePanelSize('dockRepositoryWidth', 240, 200, 420);
  const [changesWidth, setChangesWidth] = usePanelSize('dockChangesWidth', 310, 260, 480);
  const [historyRatio, setHistoryRatio] = usePanelSize('bottomHistoryRatio', .36, .22, .62);
  const [fileWidth, setFileWidth] = usePanelSize('fileWidth', 245, 130, 650);
  const [formHeight, setFormHeight] = usePanelSize('formHeight', 245, 185, 650);
  const [stageRatio, setStageRatio] = usePanelSize('stageRatio', .5, .2, .8);
  const [detailsWidth, setDetailsWidth] = usePanelSize('historyDetailsWidth', 340, 240, 560);
  const mainRef = useRef<HTMLElement>(null); const workspaceRef = useRef<HTMLDivElement>(null); const groupsRef = useRef<HTMLDivElement>(null);
  const [workspaceSize, setWorkspaceSize] = useState({ width: window.innerWidth, height: window.innerHeight - 130 });
  const mutationRef = useRef(false); const lastRefreshAt = useRef(0);
  const [contentRevision, setContentRevision] = useState(0);
  const [workingRevision, setWorkingRevision] = useState(0);
  const [pendingStage, setPendingStage] = useState<{ repo: string; paths: Set<string> } | null>(null);
  // 勾选只表示“选中”，不写入 Git：用户可以先把一批文件挑好，再统一暂存或提交。
  // 键带上分区（未暂存 / 已暂存），因为同一个文件可能同时出现在两侧。
  const [selected, setSelected] = useState<{ repo: string; staged: Set<string>; unstaged: Set<string> }>({ repo: '', staged: new Set(), unstaged: new Set() });
  const selectionKey = (path: string, staged: boolean) => `${staged ? 'i' : 'w'}\0${path}`;
  const selectedPaths = useCallback((staged: boolean) => {
    const source = selected.repo === repo ? (staged ? selected.staged : selected.unstaged) : new Set<string>();
    return [...source].map(key => key.slice(2));
  }, [selected, repo]);
  const selectedCount = selected.repo === repo ? selected.staged.size + selected.unstaged.size : 0;
  const toggleSelected = useCallback((path: string, staged: boolean) => setSelected(current => {
    const base = current.repo === repoRef.current ? current : { repo: repoRef.current, staged: new Set<string>(), unstaged: new Set<string>() };
    const next = new Set(base[staged ? 'staged' : 'unstaged']);
    const key = selectionKey(path, staged);
    if (next.has(key)) next.delete(key); else next.add(key);
    return { ...base, [staged ? 'staged' : 'unstaged']: next };
  }), []);
  const toggleSelectedAll = useCallback((paths: string[], staged: boolean) => setSelected(current => {
    const base = current.repo === repoRef.current ? current : { repo: repoRef.current, staged: new Set<string>(), unstaged: new Set<string>() };
    const keys = paths.map(path => selectionKey(path, staged));
    const allSelected = keys.length > 0 && keys.every(key => base[staged ? 'staged' : 'unstaged'].has(key));
    const next = new Set(allSelected ? [] : keys);
    return { ...base, [staged ? 'staged' : 'unstaged']: next };
  }), []);
  const clearSelected = useCallback(() => setSelected({ repo: repoRef.current, staged: new Set(), unstaged: new Set() }), []);
  const renderedSide = sidebar ? clamp(dockTab === 'repositories' ? sideWidth : changesWidth, dockTab === 'repositories' ? 200 : 260, workspaceSize.width - 49 - 660) : 0;
  const renderedChanges = renderedSide;
  const historyHeight = clamp(workspaceSize.height * historyRatio, 200, workspaceSize.height - 220);
  const renderedFiles = clamp(fileWidth, 130, workspaceSize.width - 49 - renderedSide - 360);
  const renderedForm = clamp(formHeight, 185, workspaceSize.height - 260);
  const renderedDetails = clamp(detailsWidth, 240, (workspaceSize.width - 49 - renderedSide) * .43);
  useEffect(() => {
    if (!workspaceRef.current) return;
    const observer = new ResizeObserver(([entry]) => setWorkspaceSize({ width: entry.contentRect.width, height: entry.contentRect.height }));
    observer.observe(workspaceRef.current); return () => observer.disconnect();
  }, [!!snapshot]);
  const resetLayout = () => { setSideWidth(240); setChangesWidth(310); setHistoryRatio(.36); setFileWidth(245); setFormHeight(245); setStageRatio(.5); setDetailsWidth(340); setSidebar(false); setNotice(t('面板布局已恢复默认；差异分隔线可双击恢复等宽')); };

  const repoRef = useRef(repo); repoRef.current = repo; const refreshId = useRef(0); const selectionRef = useRef(selection); selectionRef.current = selection; const amendRequestId = useRef(0);
  const api = window.gitvista;
  const [logCommand, setLogCommand] = useState<LogCommand>();
  const [showCommitDetails, setShowCommitDetails] = useState(() => readPanelPreference('showCommitDetails', true)); const [showPreview, setShowPreview] = useState(() => readPanelPreference('showPreview', true)); const [treeControl, setTreeControl] = useState({ scope: '', collapsed: false, id: 0 });
  useEffect(() => { try { localStorage.setItem('gitvista.showCommitDetails', String(showCommitDetails)); localStorage.setItem('gitvista.showPreview', String(showPreview)); localStorage.removeItem('gitvista.flatFiles'); } catch { /* Optional display preferences. */ } }, [showCommitDetails, showPreview]);
  const requestLog = (kind: LogCommand['kind'], value: string) => setLogCommand({ kind, value, id: Date.now() });

  const reloadSettings = useCallback(async () => { const s = await api.settings(); setSettings(s); return s; }, [api]);
  const refresh = useCallback(async (path = repoRef.current, initial = false, requestedLimit = limit) => {
    if (!path) { if (workspaceSelection.current) requestWorkspace('refresh'); return; } const id = ++refreshId.current; setLoading(true);
    try { const s = await api.query<GitSnapshot>(path, { type: 'snapshot', limit: requestedLimit }); if (id !== refreshId.current || path !== repoRef.current) return; setSnapshot(s); setContentRevision(value => value + 1); setWorkingRevision(value => value + 1); lastRefreshAt.current = Date.now(); if (initial) { setSelection(s.commits[0] ? { kind: 'commit', hash: s.commits[0].hash } : null); setDetail(null); setDiff(null); } }
    catch (e) { if (id === refreshId.current) setError(ErrorText(e)); }
    finally { if (id === refreshId.current) setLoading(false); }
  }, [api, limit]);
  useEffect(() => api.onRepositoryRefresh(() => { if (!mutationRef.current) void refresh(); }), [api, refresh]);
  const selectRepo = useCallback(async (entry: RepoEntry) => { setError(''); setNotice(''); setResult(null); setTool(null); setCloneOpen(false); setSettingsOpen(false); ++amendRequestId.current; ++refreshId.current; setWorkspaceCommand(undefined); setWorkspaceEntry(entry.kind === 'workspace' ? entry : undefined); if (entry.kind === 'workspace') { setSidebar(true); setDockTab('repositories'); } repoRef.current = entry.kind === 'workspace' ? '' : entry.path; setRepo(repoRef.current); setAmend(false); setMessage(''); setSnapshot(null); setSelection(null); setDiff(null); setDetail(null); setLogCommand(undefined); setBranchFilter(''); setAllFiles(false); setTreeEntries([]); setCode(null); setSelected({ repo: entry.path, staged: new Set(), unstaged: new Set() }); await Promise.all([reloadSettings(), entry.kind === 'workspace' ? Promise.resolve() : refresh(entry.path, true)]); }, [refresh, reloadSettings]);
  const openRepo = useCallback(async (path?: string) => { try { const entry = await api.openRepository(path); if (entry) await selectRepo(entry); } catch (e) { setError(ErrorText(e)); } }, [api, selectRepo]);
  const openWorkspace = async (path?: string, pull = false) => { try { const entry = await api.openWorkspace(path); if (entry) { await selectRepo(entry); if (pull) requestWorkspace('pull'); } } catch (cause) { setError(ErrorText(cause)); } };
  const openWorkspaceRepository = async (entry: RepoEntry, hash?: string) => { try { const origin = workspaceSelection.current; const opened = await api.openRepository(entry.path, true); if (opened) { await selectRepo(opened); setWorkspaceReturn(origin); if (hash) setSelection({ kind: 'commit', hash }); } } catch (cause) { setError(ErrorText(cause)); } };
  const refreshWorking = useCallback(async (path: string, action?: GitAction) => {
    const id = ++refreshId.current; setLoading(false);
    const state = await api.query<GitWorkingState>(path, { type: 'status' });
    if (id !== refreshId.current || path !== repoRef.current) return;
    lastRefreshAt.current = Date.now();
    setSnapshot(current => current ? { ...current, files: state.files, operation: state.operation } : current);
    setWorkingRevision(value => value + 1);
    setSelection(current => {
      if (!current || current.kind !== 'file') return current;
      const file = state.files.find(file => file.path === current.path || file.oldPath === current.path);
      if (!file) return null;
      const affected = !action?.paths?.length || action.paths.includes(current.path);
      const preferStaged = affected && action?.type === 'stage' ? true : affected && action?.type === 'unstage' ? false : current.staged;
      const staged = preferStaged ? file.staged : !(file.unstaged || file.conflict) && file.staged;
      return { kind: 'file', path: file.path, staged };
    });
  }, [api]);
  const runAction = useCallback(async (action: GitAction, label = t('操作')) => {
    if (!repoRef.current || mutationRef.current) return false;
    const actionRepo = repoRef.current; const lightweight = action.type === 'stage' || action.type === 'unstage';
    mutationRef.current = true; ++refreshId.current; setLoading(false); setBusy(label); setError('');
    if (lightweight) setPendingStage({ repo: actionRepo, paths: new Set(action.paths || []) });
    try {
      const response = await api.action(actionRepo, action); setOutput(response.output || `${label} · ${t('完成')}`);
      if (actionRepo === repoRef.current) {
        if (lightweight) await refreshWorking(actionRepo, action);
        else { await refresh(actionRepo); setSelection(current => current ? { ...current } : null); }
        // 暂存/取消暂存会改变文件所属的分区，旧勾选要么已经落地、要么指向了另一侧；
        // 清空选中可以避免「文件已移到暂存区，操作栏却仍显示已选中」的误导。
        if (lightweight) setSelected({ repo: actionRepo, staged: new Set(), unstaged: new Set() });
        if (actionRepo === repoRef.current) setNotice(`${label} · ${t('完成')}`);
      }
      return actionRepo === repoRef.current;
    } catch (e) {
      let reason = ErrorText(e);
      if (actionRepo === repoRef.current) {
        try { if (lightweight) await refreshWorking(actionRepo); else { await refresh(actionRepo); setSelection(current => current ? { ...current } : null); } }
        catch (refreshError) { reason += ` · ${t('状态刷新失败')}：${ErrorText(refreshError)}`; }
        setError(reason);
      }
      return false;
    } finally { mutationRef.current = false; setPendingStage(null); setBusy(''); }
  }, [api, refresh, refreshWorking, t]);
  const commit = useCallback(async (paths?: string[]) => {
    if (!message.trim() || busy) return false;
    const draftId = amendRequestId.current; const commitRepo = repoRef.current;
    const targets = paths?.length ? paths : undefined;
    if (await runAction({ type: 'commit', message: message.trim(), amend, signoff, paths: targets }, amend ? t('修订提交') : t('提交'))) {
      if (commitRepo === repoRef.current && draftId === amendRequestId.current) { setMessage(''); setAmend(false); clearSelected(); }
      return true;
    }
    return false;
  }, [message, amend, signoff, busy, runAction, clearSelected]);

  useEffect(() => { let alive = true; api.settings().then(async s => { if (!alive) return; setSettings(s); setSplit(s.diffView === 'split'); if (s.lastRepo) { const entry = s.repos.find(entry => entry.path === s.lastRepo); if (entry?.kind === 'workspace') { setWorkspaceEntry(entry); setSidebar(true); setDockTab('repositories'); } else { repoRef.current = s.lastRepo; setRepo(s.lastRepo); await refresh(s.lastRepo, true); } } }).catch(e => setError(ErrorText(e))); return () => { alive = false; }; }, []);
  useEffect(() => { document.documentElement.dataset.theme = settings.theme; }, [settings.theme]);
  useEffect(() => { if (notice) { const timer = setTimeout(() => setNotice(''), 3500); return () => clearTimeout(timer); } }, [notice]);
  useEffect(() => { const listener = (e: KeyboardEvent) => { if (document.querySelector('.mini-bar, .mini-edge')) return; if ((e.ctrlKey || e.metaKey) && e.altKey && e.key.toLowerCase() === 's') { e.preventDefault(); if (!busy && !tool && !cloneOpen && !credentialsOpen && !result && !settingsOpen) setSettingsOpen(true); } if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'o') { e.preventDefault(); if (!busy && !tool && !cloneOpen && !credentialsOpen && !result && !settingsOpen) void openRepo(); } if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'r') { e.preventDefault(); if (!settingsOpen && !busy && !tool && !cloneOpen && !credentialsOpen && !result) void refresh(); } if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && (e.target as HTMLElement).classList.contains('commit-message') && !tool && !cloneOpen && !credentialsOpen && !result && !settingsOpen) { e.preventDefault(); void commit(); } if (e.key === 'Escape' && !busy) { setTool(null); setMore(false); setResult(null); setCloneOpen(false); } }; window.addEventListener('keydown', listener); return () => window.removeEventListener('keydown', listener); }, [openRepo, refresh, commit, tool, cloneOpen, credentialsOpen, result, busy, settingsOpen]);
  const commitHash = selection?.kind === 'commit' ? selection.hash : undefined;
  const allTree = !!commitHash && allFiles;
  const treeScope = JSON.stringify([repo, commitHash || 'working', allTree ? 'all' : 'changes']);
  const effectiveTreeControl = treeControl.scope === treeScope ? treeControl : { collapsed: allTree, id: 0 };
  useEffect(() => { setTreeControl({ scope: treeScope, collapsed: allTree, id: 0 }); }, [treeScope]);
  const controlTree = (collapsed: boolean) => setTreeControl(current => ({ scope: treeScope, collapsed, id: current.id + 1 }));
  useEffect(() => {
    if (!repo || !commitHash) { setDetail(null); return; }
    let alive = true; setDetail(current => current?.commit.hash === commitHash ? current : null);
    api.query<CommitDetail>(repo, { type: 'commit', ref: commitHash }).then(info => { if (alive) setDetail(info); }).catch(e => { if (alive) setError(ErrorText(e)); });
    return () => { alive = false; };
  }, [repo, commitHash, api, contentRevision]);


  const openTool = (id: ToolKind, values: Record<string, string | boolean> = {}) => { const spec = TOOLS.find(t => t.id === id)!; const defaults: Record<string, string | boolean> = {}; spec.fields.forEach(f => { if (f.type === 'select') defaults[f.key] = f.options![0]; }); if (id === 'pull') defaults.mode = settings.pullStrategy; if (selection?.kind === 'commit' && ['cherryPick', 'revert', 'revertFile', 'reset', 'tagCreate', 'exportPatch'].includes(id)) defaults.ref = selection.hash; if (selection?.kind === 'file' && ['blame', 'fileHistory', 'resolve', 'conflictEditor', 'ignore', 'discard'].includes(id)) defaults.path = selection.path; setToolValues({ ...defaults, ...values }); setTool(id); setMore(false); setToolSearch(''); };
  const executeTool = async (event: React.FormEvent) => { event.preventDefault(); if (!tool || !repo) return; const spec = TOOLS.find(t => t.id === tool)!; const values = Object.fromEntries(Object.entries(toolValues).filter(([, value]) => value !== ''));
    if (spec.query) { setBusy(t(spec.label)); setError(''); try { const query = { ...values, type: tool === 'conflictEditor' ? 'fileContent' : tool } as GitQuery; const requestRepo = repo; const data = await api.query<unknown>(requestRepo, query); if (requestRepo !== repoRef.current) return; if (tool === 'compare') setResult({ title: t('引用比较'), diff: data as DiffResult }); else if (tool === 'fileHistory' || tool === 'reflog') setResult({ title: spec.label, commits: data as GitCommit[] }); else setResult({ title: spec.label, text: String(data), editPath: tool === 'conflictEditor' ? String(values.path) : undefined, repo: requestRepo }); setTool(null); } catch (e) { setError(ErrorText(e)); } finally { setBusy(''); } return; }
    if (tool === 'exportPatch') { try { const path = await api.exportPatch(repo, values.ref as string); if (path) { setNotice(`${t('补丁已导出')}：${path}`); setTool(null); } } catch (e) { setError(ErrorText(e)); } return; }
    const action = { ...values, type: tool } as GitAction; if (['discard', 'ignore', 'resolve'].includes(tool) && values.path) action.paths = [String(values.path)]; if (await runAction(action, t(spec.label))) setTool(null);
  };
  const changeTheme = async (theme: AppTheme) => { try { await api.setTheme(theme); setSettings(s => ({ ...s, theme })); } catch (e) { setError(ErrorText(e)); } };
  /**
   * 推送前先展示将要推送的内容，和 IDEA 一样把待推送提交与暂存区文件摆出来。
   * 用户可以直接推送（则先提交暂存区），也可以先点开某个文件检查改动。
   */
  const openPush = useCallback(async () => {
    if (!repoRef.current || busy) return;
    setPushOpen(true); setPushLoading(true); setPushError(''); setPushPreview(null); setPushDiff(null);
    const target = repoRef.current;
    try {
      const preview = await api.query<PushPreview>(target, { type: 'pushPreview' });
      if (target === repoRef.current) setPushPreview(preview);
    } catch (e) {
      if (target === repoRef.current) setPushError(ErrorText(e));
    } finally {
      if (target === repoRef.current) setPushLoading(false);
    }
  }, [api, busy]);
  const viewPushFile = useCallback(async (path: string) => {
    const target = repoRef.current;
    setPushDiff({ path, diff: null, loading: true });
    try {
      const value = await api.query<DiffResult>(target, { type: 'diff', path, staged: true });
      if (target === repoRef.current) setPushDiff({ path, diff: value, loading: false });
    } catch (e) {
      if (target === repoRef.current) { setPushDiff({ path, diff: null, loading: false }); setPushError(ErrorText(e)); }
    }
  }, [api]);
  /** 暂存区还有内容时，推送前先提交，避免把用户勾选的改动留在本地。 */
  const pushNow = useCallback(async () => {
    if (!repoRef.current || busy) return;
    const stagedNow = snapshot?.files.filter(file => file.staged) || [];
    if (stagedNow.length) {
      if (!message.trim()) { setPushError(t('推送前请填写提交说明')); return; }
      const committed = await commit(stagedNow.map(file => file.path));
      if (!committed) return;
    }
    if (await runAction({ type: 'push' }, t('推送提交'))) { setPushOpen(false); setPushPreview(null); setPushDiff(null); }
  }, [busy, snapshot, message, commit, runAction, t]);
  const files = snapshot?.files || []; const staged = files.filter(f => f.staged); const unstaged = files.filter(f => f.unstaged || f.conflict); const conflicts = files.filter(f => f.conflict);
  const selectableUnstaged = unstaged.filter(file => !file.conflict);
  const selectableStaged = staged.filter(file => !file.conflict);
  const allUnstagedSelected = selected.repo === repo && selectableUnstaged.length > 0 && selectableUnstaged.every(file => selected.unstaged.has(selectionKey(file.path, false)));
  const allStagedSelected = selected.repo === repo && selectableStaged.length > 0 && selectableStaged.every(file => selected.staged.has(selectionKey(file.path, true)));
  // 文件被暂存、提交或丢弃后，选中集合里可能留下已不存在的路径；刷新时收敛一次。
  useEffect(() => {
    setSelected(current => {
      if (current.repo !== repo) return current;
      const liveStaged = new Set(files.filter(file => file.staged && !file.conflict).map(file => selectionKey(file.path, true)));
      const liveUnstaged = new Set(files.filter(file => file.unstaged && !file.conflict).map(file => selectionKey(file.path, false)));
      const keepStaged = new Set([...current.staged].filter(key => liveStaged.has(key)));
      const keepUnstaged = new Set([...current.unstaged].filter(key => liveUnstaged.has(key)));
      if (keepStaged.size === current.staged.size && keepUnstaged.size === current.unstaged.size) return current;
      return { ...current, staged: keepStaged, unstaged: keepUnstaged };
    });
  }, [files, repo]);
  const stagedSelected = selectedPaths(true); const unstagedSelected = selectedPaths(false);  // 提交范围：优先提交勾选的文件；没有勾选时回退到全部已暂存文件，
  // 这样「什么都不选直接提交」仍然符合直觉，等价于提交暂存区。
  const commitTargets = useMemo(
    () => (selectedCount > 0 ? [...stagedSelected, ...unstagedSelected] : staged.map(file => file.path)),
    // stagedSelected / unstagedSelected 每次渲染都是新数组，以内容作为依赖更稳定。
    [selectedCount, stagedSelected.join('\0'), unstagedSelected.join('\0'), staged],
  );
  const directoryFiles = useMemo(() => {
    if (!commitHash) return files.map(file => ({ path: file.path, status: workingFileStatus(file) }));
    if (detail?.commit.hash !== commitHash) return [];
    if (!allFiles) return detail.files;
    const statuses = new Map(detail.files.map(file => [file.path, file.status]));
    return treeEntries.map(file => ({ path: file.path, submodule: file.type === 'commit', status: statuses.get(file.path) }));
  }, [commitHash, detail, allFiles, treeEntries, files]);
  const directoryCommitHash = commitHash;
  const selectDirectoryFile = useCallback((path: string) => {
    if (directoryCommitHash) { setSelection({ kind: 'commit', hash: directoryCommitHash, path }); if (allFiles) setCodeMode(true); }
    else { const file = files.find(f => f.path === path); setSelection({ kind: 'file', path, staged: !!file?.staged && !file.unstaged }); }
  }, [directoryCommitHash, allFiles, files]);
  const selectedCommit = selection?.kind === 'commit' ? (detail?.commit.hash === selection.hash ? detail.commit : snapshot?.commits.find(c => c.hash === selection.hash)) : null;
  const activePath = selection?.kind === 'file' ? selection.path : selection?.path || (detail?.commit.hash === selection?.hash ? detail?.files[0]?.path : undefined);
  const contentRef = selection?.kind === 'commit' ? selection.hash : undefined;
  const selectedStaged = selection?.kind === 'file' && selection.staged;
  const activeRevision = contentRef ? contentRevision : workingRevision;
  const deletedFile = !allFiles && selection?.kind === 'commit' && detail?.commit.hash === selection.hash && detail.files.some(f => f.path === activePath && f.status.startsWith('D'));
  const codeRef = deletedFile ? detail?.commit.parents[0] : contentRef;
  useEffect(() => {
    if (!repo || !activePath || codeMode) { setDiff(null); setDiffLoading(false); return; }
    let alive = true; setDiff(null); setDiffLoading(true);
    api.query<DiffResult>(repo, { type: 'diff', ref: contentRef, path: activePath, staged: selectedStaged }).then(value => { if (alive) setDiff(value); }).catch(e => { if (!alive) return; const result = contentError(activePath, repo, e); if ('path' in result) setNoticeFile(result); else setError(result.banner); }).finally(() => { if (alive) setDiffLoading(false); });
    return () => { alive = false; };
  }, [repo, activePath, codeMode, contentRef, selectedStaged, activeRevision, api]);
  const openFileDiff = useCallback(async () => {
    if (!repo || !activePath) return;
    const current = selectionRef.current;
    try {
      const value = diff || await api.query<DiffResult>(repo, { type: 'diff', ref: contentRef, path: activePath, staged: selectedStaged });
      if (repo === repoRef.current && current === selectionRef.current) setResult({ title: `${t('文件差异')} · ${activePath}`, diff: value });
    } catch (e) { if (repo === repoRef.current) setError(ErrorText(e)); }
  }, [repo, activePath, diff, contentRef, selectedStaged, api]);
  useEffect(() => { if (!repo || !allFiles || !contentRef) { if (!contentRef) setTreeEntries([]); return; } let alive = true; setTreeEntries([]); api.query<GitTreeEntry[]>(repo, { type: 'tree', ref: contentRef }).then(entries => { if (alive) { setTreeEntries(entries); const current = selectionRef.current; if (current?.kind === 'commit' && current.hash === contentRef && !entries.some(f => f.type === 'blob' && f.path === (current.path || activePath))) { const first = entries.find(f => f.type === 'blob'); if (first) setSelection({ kind: 'commit', hash: contentRef, path: first.path }); } } }).catch(e => { if (alive) setError(ErrorText(e)); }); return () => { alive = false; }; }, [repo, allFiles, contentRef, api]);
  useEffect(() => { if (!repo || !activePath || !codeMode || (allFiles && contentRef && !treeEntries.some(f => f.type === 'blob' && f.path === activePath))) { setCode(null); setCodeLoading(false); return; } let alive = true; setCode(null); setCodeLoading(true); api.query<string>(repo, { type: 'fileContent', path: activePath, ref: codeRef, staged: selectedStaged }).then(text => { if (alive) setCode(text); }).catch(e => { if (!alive) return; const result = contentError(activePath, repo, e); if ('path' in result) setNoticeFile(result); else setError(result.banner); }).finally(() => { if (alive) setCodeLoading(false); }); return () => { alive = false; }; }, [repo, activePath, codeMode, codeRef, selectedStaged, activeRevision, allFiles, treeEntries, api]);
  useEffect(() => { setNoticeFile(null); }, [repo, activePath]);
  useEffect(() => { const listener = (event: KeyboardEvent) => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'd' && !event.altKey && !busy && !tool && !cloneOpen && !credentialsOpen && !result && !settingsOpen && activePath && !diffLoading) { event.preventDefault(); void openFileDiff(); } }; window.addEventListener('keydown', listener); return () => window.removeEventListener('keydown', listener); }, [busy, tool, cloneOpen, result, settingsOpen, activePath, openFileDiff, diffLoading]);
  useEffect(() => { const listener = () => { if (repoRef.current && !mutationRef.current && Date.now() - lastRefreshAt.current > 1500 && !busy && !tool && !cloneOpen && !credentialsOpen && !result && !settingsOpen) void refresh().then(() => setSelection(current => current ? { ...current } : null)); }; window.addEventListener('focus', listener); return () => window.removeEventListener('focus', listener); }, [busy, tool, cloneOpen, result, settingsOpen, refresh]);
  const section = (name: string, count: number, children: React.ReactNode, add?: () => void) => <div className="side-section"><div className="section-heading"><button onClick={() => setCollapsed(s => ({ ...s, [name]: !s[name] }))}>{collapsed[name] ? <ChevronRight size={12} /> : <ChevronDown size={12} />}{name}<span>{count}</span></button>{add && <IconButton title={`添加${name}`} onClick={add}><Plus size={13} /></IconButton>}</div>{!collapsed[name] && children}</div>;
  const fileRow = (file: GitFile, isStaged: boolean) => {
    const pending = pendingStage?.repo === repo && (!pendingStage.paths.size || pendingStage.paths.has(file.path));
    const ticked = selected.repo === repo && (isStaged ? selected.staged : selected.unstaged).has(selectionKey(file.path, isStaged));
    return <div className={`change-row ${selection?.kind === 'file' && selection.path === file.path && selection.staged === isStaged ? 'selected' : ''} ${ticked ? 'ticked' : ''}`} key={`${file.path}-${isStaged}`} aria-busy={pending}>
      <input type="checkbox" checked={ticked} aria-label={`${ticked ? t('取消选择') : t('选择')} ${file.path}`} disabled={!!busy || file.conflict} onChange={() => toggleSelected(file.path, isStaged)} />
      <button className="change-file" title={file.path} onClick={() => setSelection({ kind: 'file', path: file.path, staged: isStaged })}>{pending ? <Loader2 size={14} className="spin" aria-label={t('正在更新暂存状态')} /> : <FileIcon path={file.path} size={14} />}<span className="change-file-info"><span className={`change-file-name ${fileStatusClass(workingFileStatus(file, isStaged))}`}>{basename(file.path)}</span><small>{file.path.includes('/') ? file.path.slice(0, file.path.lastIndexOf('/')) : t('根目录')}</small></span></button>
      <span className={`file-status ${fileStatusClass(workingFileStatus(file, isStaged))}`} title={statusName(t, file, isStaged)}>{file.conflict ? '!' : workingFileStatus(file, isStaged)}</span>
      {file.conflict && <IconButton title={t('解决冲突')} onClick={() => openTool('conflictEditor', { path: file.path })}><Code2 size={13} /></IconButton>}
    </div>;
  };

  return <div className={`app-shell ${settings.wordWrap ? 'code-wrap' : ''}`} style={{ '--code-font-size': `${settings.codeFontSize}px`, '--code-line-height': `${Math.round(settings.codeFontSize * 1.8)}px` } as React.CSSProperties}>
    <header className="titlebar"><div className="brand"><span className="brand-mark"><GitFork size={14} strokeWidth={2.5} /></span><span>GitVista</span></div><div className="titlebar-center">{workspaceEntry ? <><FolderGit2 size={13} />{workspaceEntry.name}<span className="title-separator">/</span><span>{t('多仓库工作区')}</span></> : snapshot ? <><FolderGit2 size={13} />{snapshot.name}<span className="title-separator">/</span><span>{t('版本控制工作台')}</span></> : t('让每一次变更，都清晰可见')}</div><div className="titlebar-language"><Languages size={14} /><SelectMenu label={t('界面语言')} className="language-picker" align="end" value={settings.language} disabled={!!busy} onChange={value => { void api.updatePreferences({ ...settings, language: value as AppLanguage }).then(saved => { setSettings(saved); onLanguageChange(saved.language); }).catch(error => setError(ErrorText(error))); }} options={[{ value: 'en', label: 'English' }, { value: 'zh', label: t('中文') }]} /></div><div className="window-controls"><button title={t('迷你横条')} onClick={() => void api.desktopCommand('mini')}><Minimize2 size={14} /></button><button title={t('收起到托盘')} onClick={() => api.windowControl('minimize')}><Minus size={14} /></button><button title={t('最大化 / 还原')} onClick={() => api.windowControl('maximize')}><Maximize2 size={12} /></button><button className="window-close" title={t('收起到托盘')} onClick={() => api.windowControl('close')}><X size={15} /></button></div></header>
    <div className="toolbar"><div className="repo-control"><IconButton title={sidebar ? t('收起侧栏') : t('展开侧栏')} onClick={() => setSidebar(!sidebar)}>{sidebar ? <PanelLeftClose size={17} /> : <PanelLeftOpen size={17} />}</IconButton><FolderGit2 size={17} /><SelectMenu label={t('选择仓库')} className="repo-picker" placeholder={t('选择仓库')} searchable searchPlaceholder={t('搜索仓库名称或路径…')} value={workspaceEntry?.path || repo} disabled={!!busy} onChange={value => { if (value === '__workspace') void openWorkspace(workspaceEntry?.path || repo || undefined); else if (value === '__open') void openRepo(); else if (value === '__clone') setCloneOpen(true); else if (value === '__credentials') setCredentialsOpen(true); else void openRepo(value); }} options={[...settings.repos.map(r => ({ value: r.path, label: r.name, description: r.path, icon: <FolderGit2 size={16} />, group: t('最近仓库') })), { value: '__open', label: t('打开本地文件夹…'), icon: <FolderOpen size={16} />, group: t('仓库操作') }, { value: '__workspace', label: t('扫描子文件夹…'), icon: <FolderGit2 size={16} />, group: t('仓库操作') }, { value: '__clone', label: t('从 Git 克隆…'), icon: <ArrowDownToLine size={16} />, group: t('仓库操作') }, { value: '__credentials', label: t('仓库授权'), icon: <ShieldCheck size={16} />, group: t('仓库操作'), disabled: !snapshot?.remotes.length }]} /><IconButton title={t('打开仓库 · Ctrl+O')} onClick={() => void openRepo()}><Plus size={15} /></IconButton></div>{snapshot && <><div className="toolbar-divider" /><div className="branch-control"><GitBranch size={15} /><SelectMenu label={t("切换当前分支")} className="branch-picker" searchable searchPlaceholder={t("搜索本地分支…")} value={snapshot.branch} disabled={!!busy} onChange={value => void runAction({ type: 'switch', ref: value }, t('切换分支'))} options={[...(!snapshot.branches.some(b => !b.remote && b.name === snapshot.branch) ? [{ value: snapshot.branch, label: snapshot.branch || t('分离 HEAD'), disabled: true }] : []), ...snapshot.branches.filter(b => !b.remote).map(b => ({ value: b.name, label: b.name, icon: <GitBranch size={15} />, group: t('本地分支') }))]} /></div><span className="sync-count" title={t("领先 / 落后远端")}>↑ {snapshot.ahead} <span>↓ {snapshot.behind}</span></span></>}<div className="toolbar-spacer" />{!workspaceEntry && workspaceReturn && <button className="text-button" disabled={!!busy} onClick={() => void openWorkspace(workspaceReturn.path)}>{t('返回多仓库工作区')}</button>}{workspaceEntry && <div className="sync-actions"><button disabled={!!busy} onClick={() => requestWorkspace('fetch')}><RefreshCw size={14} />{t('获取全部')}</button><button disabled={!!busy} onClick={() => requestWorkspace('pull')}><ArrowDown size={15} />{t('拉取全部')}</button><button className="push-button" disabled={!!busy} onClick={() => requestWorkspace('push')}><ArrowUp size={15} />{t('推送全部')}</button></div>}{snapshot && <div className="sync-actions"><button disabled={!!busy} onClick={() => void runAction({ type: 'fetch' }, t('获取远端'))} title={t('获取最新远端引用')}><RefreshCw size={14} />{t('获取')}</button><button disabled={!!busy} onClick={() => { if (!snapshot.commits.length) void openWorkspace(repo, true); else void runAction({ type: 'pull', mode: settings.pullStrategy }, t('拉取更新')); }} title={`${t('拉取更新')} · ${settings.pullStrategy}`} ><ArrowDown size={15} />{t('拉取')}</button><button className="push-button" disabled={!!busy} onClick={() => void openPush()} title={t('推送当前分支')}><ArrowUp size={15} />{t('推送')}{snapshot.ahead > 0 && <span>{snapshot.ahead}</span>}</button></div>}<div className="toolbar-divider" /><div className="theme-control">{settings.theme === 'light' ? <Sun size={15} /> : <Moon size={15} />}<SelectMenu label={t('选择主题')} className="theme-picker" align="end" value={settings.theme} onChange={value => void changeTheme(value as AppTheme)} options={THEMES.map(theme => ({ value: theme.value, label: t(theme.name), description: t(theme.detail), icon: <span className="theme-option-swatch" style={{ background: theme.colors[0], borderColor: theme.colors[2] }}>{theme.colors.slice(1).map((color, index) => <i key={index} style={{ background: color }} />)}</span> }))} /></div><IconButton title={t("Git 工具箱")} onClick={() => openTool('branchCreate')} disabled={!snapshot}><Command size={17} /></IconButton><IconButton title={t('恢复默认面板布局')} onClick={resetLayout} disabled={!snapshot}><RotateCcw size={16} /></IconButton><IconButton title={t('应用设置')} onClick={() => setSettingsOpen(true)} disabled={!!busy}><Settings2 size={17} /></IconButton></div>
    {error && <div className="error-banner" role="alert"><span className="error-dot">!</span><p>{error}</p><button onClick={() => setResult({ title: t('错误详情'), text: error })}>{t('展开')}</button><IconButton title={t('关闭错误提示')} onClick={() => setError('')}><X size={14} /></IconButton></div>}
    {snapshot?.operation && <div className="operation-banner"><GitMerge size={15} /><span>{t("正在进行")}<strong>{snapshot.operation}</strong>，{t('请解决冲突后继续。')}</span><button disabled={!!busy} onClick={() => void runAction({ type: 'continue' }, t('继续'))}>{t('继续')}</button><button disabled={!!busy} onClick={() => openTool('abort')}>{t('中止')}</button></div>}
    {workspaceEntry ? <WorkspacePanel key={workspaceEntry.path} root={workspaceEntry.path} command={workspaceCommand} layout={{ sidebar, dockTab, onDock: toggleDock, historyOpen, onHistory: () => setHistoryOpen(value => !value), settings }} onOpen={openWorkspaceRepository} onBusy={setBusy} /> : !snapshot ? <main className="welcome"><div className="welcome-content"><h1>{t('打开一个仓库')}</h1><p>{t('从本地目录、远程地址或一个全新的空仓库开始。')}</p><div className="welcome-actions"><button className="primary-button" onClick={() => void openRepo()}><FolderOpen size={16} />{t('打开本地仓库')}</button><button className="secondary-button" onClick={() => setCloneOpen(true)}><ArrowDownToLine size={15} />{t('克隆仓库')}</button></div><div className="welcome-hint"><button className="text-button" onClick={async () => { try { const r = await api.initRepository(); if (r) await selectRepo(r); } catch (e) { setError(ErrorText(e)); } }}><Plus size={14} />{t('初始化一个新仓库')}</button><span className="hint-separator">·</span><kbd>Ctrl</kbd><span>+</span><kbd>O</kbd><span>{t('快速打开')}</span></div>{settings.repos.length > 0 && <div className="recent-repos"><div className="subtle-heading">{t('最近使用')}</div>{settings.repos.slice(0, 5).map(r => <button key={r.path} onClick={() => void openRepo(r.path)}><FolderGit2 size={16} /><span>{r.name}<small>{r.path}</small></span><ChevronRight size={14} /></button>)}</div>}</div>{loading && <div className="loading-overlay"><Loader2 className="spin" size={22} /><span>{t('正在读取仓库…')}</span></div>}</main> : <div ref={workspaceRef} className={`workspace ${sidebar ? '' : 'sidebar-hidden'}`} style={{ '--side-width': `${renderedSide}px`, '--changes-width': `${renderedChanges}px`, '--history-height': `${historyHeight}px` } as React.CSSProperties}>
      <nav className="icon-rail" aria-label={t('工具窗口')}>
        <IconButton title={t('仓库与分支')} className={sidebar && dockTab === 'repositories' ? 'active' : ''} onClick={() => toggleDock('repositories')}><FolderGit2 size={21} /></IconButton>
        <IconButton title={t('本地变更')} className={sidebar && dockTab === 'changes' ? 'active' : ''} onClick={() => toggleDock('changes')}><Files size={20} />{files.length > 0 && <i />}</IconButton>
        <div className="rail-divider" />
        <IconButton title={t('提交历史')} className={historyOpen ? 'active' : ''} aria-pressed={historyOpen} onClick={() => setHistoryOpen(current => !current)}><History size={20} /></IconButton>
        <div className="rail-spacer" /><IconButton title={t('在文件管理器中打开')} onClick={() => void api.revealPath(repo).catch(e => setError(ErrorText(e)))}><FolderOpen size={19} /></IconButton>
      </nav>
      {sidebar && dockTab === 'repositories' && <aside className="sidebar"><div className="sidebar-title"><span>{t('仓库与分支')}</span><span className="small-badge">{settings.repos.length}</span><IconButton title={t('克隆仓库')} onClick={() => setCloneOpen(true)}><Plus size={14} /></IconButton></div><div className="repo-list">{settings.repos.map(r => <div className={`repo-row ${r.path === repo ? 'active' : ''}`} key={r.path}><button title={r.path} onClick={() => void openRepo(r.path)}><FolderGit2 size={15} /><span>{r.name}</span>{r.path === repo && <span className="live-dot" />}</button><IconButton title={t('从最近仓库中移除（不删除文件）')} onClick={() => { void api.forgetRepository(r.path).then(async () => { await reloadSettings(); if (r.path === repo) { ++refreshId.current; repoRef.current = ''; setRepo(''); setLoading(false); setSnapshot(null); setSelection(null); setDiff(null); } }).catch(e => setError(ErrorText(e))); }}><X size={11} /></IconButton></div>)}</div><div className="side-search"><Search size={13} /><input placeholder={t('查找分支…')} value={branchFilter} onChange={e => setBranchFilter(e.target.value)} /></div><div className="sidebar-scroll">{section(t('本地分支'), snapshot.branches.filter(b => !b.remote).length, snapshot.branches.filter(b => !b.remote && b.name.toLowerCase().includes(branchFilter.toLowerCase())).map(b => <div className={`branch-row ${b.current ? 'current' : ''}`} key={b.name}><button title={`${b.name}\n${b.subject}\n${t('双击切换分支')}`} onClick={() => openTool('switch', { ref: b.name })} onDoubleClick={() => void runAction({ type: 'switch', ref: b.name }, t('切换分支'))}><GitBranch size={14} /><span>{b.name}</span>{b.current && <Check size={13} />}</button><IconButton title={t('分支操作')} onClick={() => openTool('switch', { ref: b.name })}><MoreHorizontal size={12} /></IconButton></div>), () => openTool('branchCreate'))}{section(t('远端分支'), snapshot.branches.filter(b => b.remote).length, snapshot.branches.filter(b => b.remote && b.name.toLowerCase().includes(branchFilter.toLowerCase())).map(b => <div className="branch-row" key={b.name}><button title={b.name} onClick={() => openTool('switch', { ref: b.name })}><GitBranch size={13} /><span>{b.name}</span></button></div>))}{section(t('Stashes'), snapshot.stashes.length, snapshot.stashes.length ? snapshot.stashes.map(s => <div className="branch-row" key={s.ref}><button title={`${s.ref}\n${s.subject}`} onClick={() => openTool('stashApply', { ref: s.ref })}><Layers3 size={13} /><span>{s.subject}</span></button><IconButton title={t('删除 Stash')} onClick={() => openTool('stashDrop', { ref: s.ref })}><Trash2 size={12} /></IconButton></div>) : <div className="side-empty">{t('没有保存的暂存')}</div>, () => openTool('stashSave'))}{section(t('标签'), snapshot.tags.length, snapshot.tags.length ? snapshot.tags.map(tag => <div className="branch-row" key={tag.name}><button title={tag.subject} onClick={() => requestLog('locate', tag.name)}><Tag size={13} /><span>{tag.name}</span></button><IconButton title={t('删除标签')} onClick={() => openTool('tagDelete', { name: tag.name })}><Trash2 size={12} /></IconButton></div>) : <div className="side-empty">{t('还没有标签')}</div>, () => openTool('tagCreate'))}{section(t('远程仓库'), snapshot.remotes.length, snapshot.remotes.map(r => <div className="branch-row" key={r.name}><button title={r.fetch} onClick={() => openTool('remoteSetUrl', { name: r.name, url: r.fetch.includes('***') ? '' : r.fetch })}><ArrowUpRight size={13} /><span>{r.name}</span></button></div>), () => openTool('remoteAdd'))}{section(t('工作树'), snapshot.worktrees.length, snapshot.worktrees.map(w => <div className="branch-row" key={w.path}><button title={w.path} onClick={() => void openRepo(w.path)}><FolderGit2 size={13} /><span>{basename(w.path)}</span></button></div>), () => openTool('worktreeAdd'))}</div><div className="sidebar-bottom"><ShieldCheck size={14} /><span>{t('本地 Git · 你的代码由你掌控')}</span></div></aside>}
      {sidebar && dockTab === 'changes' && <aside className="changes-panel" aria-label={t('本地变更') + ' ' + t('工具窗口')}><div className="panel-heading"><div className="panel-tab"><Files size={15} />{t('本地变更')}<span>{files.length}</span></div><IconButton title={t('刷新本地变更')} disabled={!!busy} onClick={() => void refreshWorking(repo).then(() => setNotice(t('刷新工作区状态，显示最新修改')))}><RefreshCw size={14} className={loading ? 'spin' : ''} /></IconButton><IconButton title={t('暂存到 Stash')} disabled={!!busy || !files.length} onClick={() => openTool('stashSave')}><Layers3 size={15} /></IconButton></div><div className="changes-branch"><span className="live-dot" /><GitBranch size={13} /><strong>{snapshot.branch}</strong><span>{snapshot.upstream ? `${t('跟踪')} ${snapshot.upstream}` : t('本地分支状态')}</span></div>{conflicts.length > 0 && <div className="conflict-notice"><span>!</span>{conflicts.length} {t('个文件需要解决冲突')}</div>}<div className="change-groups" ref={groupsRef}>
        <section className="change-group unstaged-group" style={{ flexBasis: `${stageRatio * 100}%` }} aria-label={t('未暂存')}><div className="change-group-title"><ChevronDown size={12} /><strong>{t('未暂存')}</strong><span>{unstaged.length}</span><button disabled={!!busy || !selectableUnstaged.length} aria-pressed={allUnstagedSelected} onClick={() => toggleSelectedAll(selectableUnstaged.map(f => f.path), false)}>{t(allUnstagedSelected ? '全不选' : '全选')}</button></div><div className="change-group-list">{unstaged.map(f => fileRow(f, false))}{!unstaged.length && <div className="change-empty">{t('工作区没有未暂存更改')}</div>}</div></section>
        <ResizeHandle direction="horizontal" label={t('调整未暂存与已暂存区域高度')} onResize={delta => setStageRatio(current => clamp(current + delta / Math.max(1, groupsRef.current?.clientHeight || 1), .2, .8))} onReset={() => setStageRatio(.5)} />
        <section className="change-group staged-group" aria-label={t('已暂存')}><div className="change-group-title"><ChevronDown size={12} /><strong>{t('已暂存')}</strong><span>{staged.length}</span><button disabled={!!busy || !selectableStaged.length} aria-pressed={allStagedSelected} onClick={() => toggleSelectedAll(selectableStaged.map(f => f.path), true)}>{t(allStagedSelected ? '全不选' : '全选')}</button></div><div className="change-group-list">{staged.map(f => fileRow(f, true))}{!staged.length && <div className="staging-placeholder"><CheckCheck size={21} /><span>{t('勾选文件，将更改加入暂存区')}</span></div>}</div></section>
      </div>
      <div className="change-actions">
        <button type="button" disabled={!!busy || !unstagedSelected.length} onClick={() => void runAction({ type: 'stage', paths: unstagedSelected }, t('暂存选中'))}><Plus size={13} />{t('暂存选中')}{unstagedSelected.length ? ` (${unstagedSelected.length})` : ''}</button>
        <button type="button" disabled={!!busy || !stagedSelected.length} onClick={() => void runAction({ type: 'unstage', paths: stagedSelected }, t('取消暂存选中'))}><Minus size={13} />{t('取消暂存')}{stagedSelected.length ? ` (${stagedSelected.length})` : ''}</button>
        {selectedCount > 0 && <button type="button" className="text-button" onClick={clearSelected}>{t('清除')}</button>}
      </div>
      <ResizeHandle direction="horizontal" label={t('调整变更列表与提交区域高度')} onResize={delta => setFormHeight(current => clamp(clamp(current, 185, workspaceSize.height - 260) - delta, 185, workspaceSize.height - 260))} onReset={() => setFormHeight(245)} /><form className="commit-form" style={{ height: renderedForm }} onSubmit={e => { e.preventDefault(); void commit(commitTargets); }}><div className="commit-form-label"><span>{t('提交说明')}</span><span>{amend ? 'AMEND' : 'COMMIT'}</span></div><textarea className="commit-message" placeholder={t('这次改动做了什么？')} value={message} onChange={e => { ++amendRequestId.current; setMessage(e.target.value); }} required /><div className="commit-options"><label title={t('将改动加入上一个提交，会改写其哈希')}><input type="checkbox" checked={amend} onChange={e => { setAmend(e.target.checked); const id = ++amendRequestId.current; const requestRepo = repo; if (e.target.checked && !message) void api.query<CommitDetail>(requestRepo, { type: 'commit', ref: 'HEAD' }).then(d => { if (id === amendRequestId.current && requestRepo === repoRef.current) setMessage(d.body || d.commit.subject); }).catch(err => { if (id === amendRequestId.current && requestRepo === repoRef.current) setError(ErrorText(err)); }); }} />{t('修订上次提交')}</label><label title={t('添加 Signed-off-by')}><input type="checkbox" checked={signoff} onChange={e => setSignoff(e.target.checked)} />{t('签署')}</label></div><button className="commit-button" type="submit" disabled={!!busy || !message.trim() || (!commitTargets.length && !staged.length && !amend) || !!conflicts.length}><GitCommitHorizontal size={17} /><span>{amend ? t('修订提交') : commitTargets.length ? `${t('提交')} ${commitTargets.length} ${t('个文件')}` : t('提交')}</span><kbd>Ctrl ↵</kbd></button><div className="commit-tip"><ShieldCheck size={11} />{t('提交保存在本地，推送后与团队共享。')}</div></form></aside>}
      {sidebar && <ResizeHandle direction="vertical" label={t('调整左侧工具窗口宽度')} onResize={delta => { if (dockTab === 'repositories') setSideWidth(current => clamp(clamp(current, 200, workspaceSize.width - 49 - 660) + delta, 200, Math.min(420, workspaceSize.width - 49 - 660))); else setChangesWidth(current => clamp(clamp(current, 260, workspaceSize.width - 49 - 660) + delta, 260, Math.min(480, workspaceSize.width - 49 - 660))); }} onReset={() => dockTab === 'repositories' ? setSideWidth(240) : setChangesWidth(310)} />}
      <main className="main-workspace" ref={mainRef}>
        <section className="diff-panel"><div className="panel-heading"><div className="panel-tab"><FileDiff size={15} />{selection?.kind === 'file' ? t('工作区代码') : t('历史代码')}{detail && <span>{detail.files.length} {t('个文件')}</span>}</div><div className="panel-heading-actions"><div className="segmented view-toggle"><button className={!codeMode ? 'active' : ''} onClick={() => setCodeMode(false)}>{t("差异")}</button><button className={codeMode ? 'active' : ''} onClick={() => setCodeMode(true)}>{t("完整代码")}</button></div><div className="segmented"><button className={!split ? 'active' : ''} onClick={() => setSplit(false)} title={t("统一差异")}>{t("统一")}</button><button className={split ? 'active' : ''} onClick={() => setSplit(true)} title={t("并排差异")}>{t("并排")}</button></div><IconButton title={settings.wordWrap ? t('关闭代码自动换行') : t('开启代码自动换行')} className={settings.wordWrap ? "active" : ""} onClick={() => { const next = { ...settings, wordWrap: !settings.wordWrap }; setSettings(next); void api.updatePreferences(next).catch(e => setError(ErrorText(e))); }}><WrapText size={15} /></IconButton><IconButton title={t("文件历史")} disabled={!activePath} onClick={() => openTool('fileHistory', { path: activePath || '', ref: contentRef || '' })}><History size={14} /></IconButton><IconButton title={t("逐行追溯")} disabled={!activePath} onClick={() => openTool('blame', { path: activePath || '' })}><Code2 size={14} /></IconButton></div></div><div className="diff-body"><><div className={`commit-files ${showPreview ? '' : 'without-preview'}`} style={{ width: showPreview ? renderedFiles : undefined }}><div className="file-directory-heading"><FolderOpen size={14} /><strong>{t("文件目录")}</strong><span>{selection?.kind === 'commit' ? selectedCommit?.short : snapshot.branch}</span></div>{detail && <><div className="tree-mode"><button className={!allFiles ? 'active' : ''} onClick={() => { setAllFiles(false); controlTree(false); }}>{t("改动文件")}</button><button className={allFiles ? 'active' : ''} onClick={() => { setAllFiles(true); setCodeMode(true); controlTree(true); }}>{t("全部文件")}</button></div><div className="commit-file-toolbar" aria-label={t("历史文件工具栏")}><IconButton title={t("显示差异 · Ctrl+D")} disabled={!activePath || diffLoading || !!busy} onClick={() => void openFileDiff()}><ArrowLeftRight size={14} /></IconButton><IconButton title={t("反向撤销所选历史文件改动")} disabled={!activePath || !!busy || allFiles} onClick={() => openTool('revertFile', { ref: detail.commit.hash, path: activePath || '' })}><Undo2 size={14} /></IconButton><IconButton title={t("截至此提交的文件历史")} disabled={!activePath || !!busy} onClick={() => openTool('fileHistory', { path: activePath || '', ref: detail.commit.hash })}><History size={14} /></IconButton><span className="file-toolbar-divider" /><IconButton title={t("展开全部目录")} onClick={() => controlTree(false)}><ChevronsUpDown size={14} /></IconButton><IconButton title={t("折叠全部目录")} onClick={() => controlTree(true)}><ChevronsDownUp size={14} /></IconButton><IconButton title={showCommitDetails ? t('隐藏提交详情') : t('显示提交详情')} className={showCommitDetails ? 'active' : ''} onClick={() => setShowCommitDetails(value => !value)}><Eye size={14} /></IconButton><IconButton title={showPreview ? t('隐藏差异预览') : t('显示差异预览')} onClick={() => setShowPreview(value => !value)}>{showPreview ? <PanelRightClose size={14} /> : <PanelRightOpen size={14} />}</IconButton></div></>}{!detail && <div className="commit-file-toolbar" aria-label={t("工作区目录工具栏")}><IconButton title={t("展开全部目录")} onClick={() => controlTree(false)}><ChevronsUpDown size={14} /></IconButton><IconButton title={t("折叠全部目录")} onClick={() => controlTree(true)}><ChevronsDownUp size={14} /></IconButton></div>}<FileTree key={treeScope} files={directoryFiles} selected={activePath} control={effectiveTreeControl} onSelect={selectDirectoryFile} /></div>{showPreview && <ResizeHandle direction="vertical" label={t("调整文件目录与代码宽度")} onResize={delta => setFileWidth(current => clamp(clamp(current, 130, (mainRef.current?.clientWidth || 600) - 360) + delta, 130, Math.max(130, (mainRef.current?.clientWidth || 600) - 240)))} onReset={() => setFileWidth(245)} />}</>{(showPreview || !detail) && <div className="diff-content">{activePath && <div className="diff-filebar"><FileIcon path={activePath} size={14} /><span className="diff-file-path" title={activePath}>{activePath}</span>{deletedFile && codeMode && <span className="diff-stage-label">{t("删除前版本")}</span>}{selection?.kind === 'file' && <span className="diff-stage-label">{selection.staged ? t('已暂存') : t('未暂存')}</span>}<IconButton title={t("在文件管理器中显示")} onClick={() => void api.revealPath(repo, activePath).catch(e => setError(ErrorText(e)))}><ArrowUpRight size={12} /></IconButton></div>}{(codeMode ? codeLoading : diffLoading) ? <div className="inline-loading"><Loader2 size={18} className="spin" />{t(codeMode ? t('读取代码…') : t('读取差异…'))}</div> : noticeFile?.repo === repo && noticeFile.path === activePath ? <div className="soft-notice" role="status"><div className="soft-notice-icon"><FileWarning size={26} /></div><strong>{t('无法预览该文件')}</strong><p>{noticeFile.message}</p><div className="soft-notice-actions"><button type="button" onClick={() => void api.revealPath(repo, activePath).catch(() => setNotice(t('在文件管理器中显示')))}><ArrowUpRight size={13} />{t('在文件管理器中显示')}</button></div></div> : codeMode ? <CodeViewer text={code} path={activePath} /> : <DiffViewer diff={diff} path={activePath} split={split} wordWrap={settings.wordWrap} fontSize={settings.codeFontSize} />}</div>}</div></section>
        {historyOpen && <ResizeHandle direction="horizontal" label={t('调整代码与历史区域高度')} onResize={delta => setHistoryRatio(current => clamp(current - delta / workspaceSize.height, .22, .62))} onReset={() => setHistoryRatio(.36)} />}
        {historyOpen ? <div className="history-dock" style={{ height: historyHeight }}>
          <LogPanel key={repo} repo={repo} snapshot={snapshot} selected={selection?.kind === 'commit' ? selection.hash : undefined} busy={!!busy} blocked={!!tool || cloneOpen || credentialsOpen || !!result || settingsOpen} refreshing={loading} command={logCommand} inCurrentBranch={detail?.commit.hash === (selection?.kind === 'commit' ? selection.hash : undefined) ? detail?.inCurrentBranch : undefined} onSelect={hash => setSelection({ kind: 'commit', hash })} onRefresh={() => void refresh()} onTool={openTool} />
          {showCommitDetails && <><ResizeHandle direction="vertical" label={t("调整历史与提交详情宽度")} onResize={delta => setDetailsWidth(current => clamp(clamp(current, 240, (workspaceSize.width - 49 - renderedSide) * .43) - delta, 240, Math.min(560, (workspaceSize.width - 49 - renderedSide) * .43)))} onReset={() => setDetailsWidth(340)} /><aside className="history-details" style={{ width: renderedDetails }} aria-label={t("提交信息")}><div className="panel-heading"><div className="panel-tab"><GitCommitHorizontal size={15} />{t("提交信息")}</div><IconButton title={t("收起提交信息")} onClick={() => setShowCommitDetails(false)}><X size={14} /></IconButton></div>{detail ? <CommitDetails detail={detail} root={detail.root || repo} onBranch={branch => requestLog('branch', branch)} onCopy={hash => void navigator.clipboard.writeText(hash).then(() => setNotice(t('提交哈希已复制'))).catch(e => setError(ErrorText(e)))} /> : <Empty title={t("选择一条提交记录")} detail={t("在左侧历史中查看作者、说明和所属分支。")} />}</aside></>}
          {!showCommitDetails && <button className="reopen-details" title={t('展开提交信息')} onClick={() => setShowCommitDetails(true)}><PanelRightOpen size={16} /><span>{t('提交信息')}</span></button>}
        </div> : <button className="reopen-history" title={t('提交历史')} onClick={() => setHistoryOpen(true)}><History size={15} /><span>{t('提交历史')}</span></button>}
      </main>
    </div>}
    <footer className="statusbar"><span className={busy || loading ? 'status-working' : 'status-ready'}>{busy || loading ? <Loader2 size={12} className="spin" /> : <span className="live-dot" />}{busy ? `${busy}…` : loading ? t('正在刷新仓库…') : t('就绪')}</span>{snapshot && <span><GitBranch size={12} />{snapshot.branch}</span>}<div className="statusbar-spacer" />{notice && <span className="status-notice"><Check size={12} />{notice}</span>}<button onClick={() => setResult({ title: t('操作输出'), text: output || t('尚未执行 Git 写入操作。') })}><SquareTerminal size={12} />{t('操作输出')}</button><span className="git-version">{snapshot?.gitVersion || 'GitVista 0.9.1'}</span></footer>
    {settingsOpen && <SettingsDialog key={repo} settings={settings} repo={repo} onClose={() => setSettingsOpen(false)} onSaved={saved => { setSettings(saved); setSplit(saved.diffView === 'split'); onLanguageChange(saved.language); setNotice(t('应用设置已保存')); if (repoRef.current) void refresh(); }} />}
    {tool && <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget && !busy) setTool(null); }}><div className="tool-modal" role="dialog" aria-modal="true" aria-label={t('Git 工具箱')}><div className="tool-sidebar"><div className="tool-sidebar-title"><Command size={18} />{t('Git 工具箱')}</div><div className="tool-search"><Search size={14} /><input autoFocus value={toolSearch} placeholder={t('查找操作…')} onChange={e => setToolSearch(e.target.value)} /></div><div className="tool-list">{[...new Set(TOOLS.map(spec => spec.group))].map(group => { const items = TOOLS.filter(spec => spec.group === group && `${t(spec.label)}${t(spec.hint)}`.includes(toolSearch)); return items.length ? <div key={group}><div className="tool-group">{t(group)}</div>{items.map(spec => <button key={spec.id} className={tool === spec.id ? 'active' : ''} onClick={() => { const defaults: Record<string, string | boolean> = {}; spec.fields.forEach(f => { if (f.type === 'select') defaults[f.key] = f.options![0]; }); if (spec.id === 'pull') defaults.mode = settings.pullStrategy; setToolValues(old => ({ ...defaults, ...Object.fromEntries(Object.entries(old).filter(([key]) => spec.fields.some(f => f.key === key && f.type !== 'select'))) })); setTool(spec.id); }}>{t(spec.label)}<ChevronRight size={12} /></button>)}</div> : null; })}</div></div><form className="tool-main" onSubmit={executeTool}><div className="modal-top"><IconButton title={t('关闭')} disabled={!!busy} onClick={() => setTool(null)}><X size={19} /></IconButton></div><h2>{t(TOOLS.find(spec => spec.id === tool)!.label)}</h2><p className="tool-hint">{t(TOOLS.find(spec => spec.id === tool)!.hint)}</p><div className="tool-repo"><FolderGit2 size={13} />{snapshot?.name}<ChevronRight size={12} /><GitBranch size={12} />{snapshot?.branch}</div><div className="tool-fields">{TOOLS.find(spec => spec.id === tool)?.fields.map(f => <label className={f.type === 'check' ? 'checkbox-field' : 'form-field'} key={f.key}>{f.type !== 'check' && <span>{t(f.label)}{f.required && <i> *</i>}</span>}{f.type === 'check' ? <><input type="checkbox" checked={!!toolValues[f.key]} onChange={e => setToolValues(v => ({ ...v, [f.key]: e.target.checked }))} />{t(f.label)}</> : f.type === 'select' ? <SelectMenu label={t(f.label)} value={String(toolValues[f.key] || f.options![0])} disabled={!!busy} onChange={value => setToolValues(v => ({ ...v, [f.key]: value }))} options={f.options!.map(value => ({ value, label: value }))} /> : f.type === 'area' ? <textarea value={String(toolValues[f.key] || '')} placeholder={f.placeholder && t(f.placeholder)} required={f.required} onChange={e => setToolValues(v => ({ ...v, [f.key]: e.target.value }))} /> : <input value={String(toolValues[f.key] || '')} placeholder={f.placeholder && t(f.placeholder)} required={f.required} onChange={e => setToolValues(v => ({ ...v, [f.key]: e.target.value }))} spellCheck={false} />}</label>)}</div>{error && <div className="modal-error">{error}</div>}<div className="modal-actions"><button type="button" className="secondary-button" disabled={!!busy} onClick={() => setTool(null)}>{t('取消')}</button><button className={TOOLS.find(spec => spec.id === tool)?.danger ? 'danger-button' : 'primary-button'} disabled={!!busy || !repo}>{busy ? <Loader2 size={15} className="spin" /> : <ArrowUpRight size={15} />}{TOOLS.find(t => t.id === tool)?.query ? t('查看') : t('执行操作')}</button></div></form></div></div>}
    {pushOpen && <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget && !busy) { setPushOpen(false); setPushDiff(null); } }}><div className="push-modal" role="dialog" aria-modal="true" aria-label={t('推送预览')}>
      <div className="push-heading"><div><ArrowUp size={17} /><strong>{t('推送预览')}</strong>{pushPreview && <span className="push-target">{pushPreview.remote}/{pushPreview.target}</span>}</div><IconButton title={t('重新读取推送内容')} disabled={pushLoading} onClick={() => void openPush()}><RefreshCw size={15} className={pushLoading ? 'spin' : ''} /></IconButton><IconButton title={t('关闭')} disabled={!!busy} onClick={() => { setPushOpen(false); setPushDiff(null); }}><X size={18} /></IconButton></div>
      <div className="push-body">
        <div className="push-list">
          {pushLoading && !pushPreview ? <div className="inline-loading"><Loader2 size={17} className="spin" />{t('读取差异…')}</div> : <>
            <div className="push-section-title"><GitCommitHorizontal size={13} />{t('待推送提交')}<span>{pushPreview?.commits.length || 0}</span></div>
            <div className="push-commits">{pushPreview?.commits.length ? pushPreview.commits.map(commit => <div className="push-commit" key={commit.hash}><span className="commit-hash">{commit.short}</span><span title={commit.subject}>{commit.subject}</span><small>{commit.author}</small></div>) : <div className="change-empty">{t('没有待推送的提交')}</div>}</div>
            <div className="push-section-title"><Files size={13} />{t('暂存区文件')}<span>{staged.length}</span></div>
            <div className="push-files">{staged.length ? staged.map(file => <button type="button" key={file.path} className={`push-file ${pushDiff?.path === file.path ? 'active' : ''}`} title={file.path} onClick={() => void viewPushFile(file.path)}><FileIcon path={file.path} size={14} /><span>{file.path}</span><i className={fileStatusClass(workingFileStatus(file))}>{workingFileStatus(file)}</i></button>) : <div className="change-empty">{t('没有暂存文件')}</div>}</div>
            <p className="push-hint">{staged.length ? t('点击文件名查看它的改动；直接推送会一并提交暂存区内容。') : t('暂无未推送的提交，直接推送将提交暂存区内容。')}</p>
          </>}
        </div>
        <div className="push-preview-pane">
          {pushDiff ? <><div className="diff-filebar"><FileIcon path={pushDiff.path} size={14} /><span className="diff-file-path" title={pushDiff.path}>{pushDiff.path}</span><span className="diff-stage-label">{t('已暂存版本')}</span></div>{pushDiff.loading ? <div className="inline-loading"><Loader2 size={18} className="spin" />{t('读取差异…')}</div> : <DiffViewer diff={pushDiff.diff} path={pushDiff.path} split={split} wordWrap={settings.wordWrap} fontSize={settings.codeFontSize} />}</> : <Empty title={t('暂存区文件')} detail={t('点击文件名查看它的改动；直接推送会一并提交暂存区内容。')} icon={<FileDiff size={28} />} />}
        </div>
      </div>
      {pushError && <div className="modal-error">{pushError}</div>}
      <div className="modal-actions"><button type="button" className="secondary-button" disabled={!!busy} onClick={() => { setPushOpen(false); setPushDiff(null); }}>{t('取消推送')}</button><button type="button" className="primary-button" disabled={!!busy || pushLoading || (!pushPreview?.total && !staged.length)} onClick={() => void pushNow()}>{busy ? <Loader2 size={15} className="spin" /> : <ArrowUp size={15} />}{staged.length ? t('提交并推送') : t('推送这一份')}</button></div>
    </div></div>}
    {cloneOpen && <RepositoryDialog onClose={() => setCloneOpen(false)} onCloned={selectRepo} onBusy={setBusy} />}
    {credentialsOpen && <RepositoryDialog repo={repo} remotes={snapshot?.remotes} onClose={() => setCredentialsOpen(false)} onCloned={selectRepo} onBusy={setBusy} />}
    {result && <div className="modal-backdrop"><div className="result-modal" role="dialog" aria-modal="true" aria-label={result.title}><div className="result-heading"><div><FileDiff size={17} /><strong>{result.title}</strong>{result.editPath && <span>{result.editPath}</span>}</div><IconButton title={t("关闭")} onClick={() => setResult(null)}><X size={19} /></IconButton></div>{result.diff ? <DiffViewer diff={result.diff} split={false} wordWrap={settings.wordWrap} fontSize={settings.codeFontSize} /> : result.commits ? <div className="result-commits">{result.commits.length ? result.commits.map((c, index) => <button key={`${c.hash}-${index}`} onClick={() => { setSelection({ kind: 'commit', hash: c.hash }); setResult(null); }}><span className="commit-hash">{c.short}</span><span>{c.subject}</span><small>{c.author}</small><small>{shortDate(c.date, locale)}</small></button>) : <Empty title={t('没有记录')} />}</div> : result.editPath ? <><div className="editor-hint">{t('删除冲突标记并保留正确代码，保存后请将该文件暂存。')}</div><textarea className="conflict-editor" spellCheck={false} value={result.text || ''} onChange={e => setResult(r => r ? { ...r, text: e.target.value } : r)} /><div className="editor-actions"><button className="primary-button" disabled={!!busy} onClick={async () => { if (result.repo !== repoRef.current) { setError(t('仓库已切换，请重新打开当前仓库的文件进行编辑。')); return; } if (await runAction({ type: 'saveFile', path: result.editPath, content: result.text || '' }, t('保存文件'))) { const path = result.editPath; setResult(null); openTool('resolve', { path: path || '', mode: 'mark' }); } }}><Check size={15} />{t('保存文件')}</button></div></> : <pre className="result-text">{result.text || t('没有输出。')}</pre>}</div></div>}
  </div>;
}
