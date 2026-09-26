import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUpRight, Files, FolderGit2, FolderOpen, GitBranch, GitCommitHorizontal, History, Loader2, PanelLeftClose, RefreshCw, X } from 'lucide-react';
import type { AppPreferences, CommitDetail, DiffResult, RepoEntry, WorkspaceRepository } from '../../shared/types';
import { createWorkspaceLog, relativeRepository, splitWorkspaceRef, workspaceFilePath, workspaceRef, workspaceSnapshot } from '../lib/workspace-log';
import { clamp, usePanelSize } from '../lib/panel-preferences';
import { useI18n } from '../lib/i18n';
import LogPanel, { type LogCommand, type LogSource } from './LogPanel';
import CommitDetails from './CommitDetails';
import CodeViewer from './CodeViewer';
import DiffViewer from './DiffViewer';
import FileTree from './FileTree';
import { useFileHistory } from './FileHistory';
import FileIcon from './FileIcon';
import WorkspaceFileTree from './WorkspaceFileTree';
import ResizeHandle from './ResizeHandle';
import SelectMenu from './SelectMenu';

export interface WorkspaceLayout {
  sidebar: boolean; dockTab: 'repositories' | 'changes'; onDock: (tab: 'repositories' | 'changes') => void;
  historyOpen: boolean; onHistory: () => void; settings: AppPreferences;
}
type FileSelection = { path: string; repo?: string; relative?: string; ref?: string; staged?: boolean; deleted?: boolean };
export default function WorkspaceWorkbench({ root, repositories, selected, working, blocked, layout, onToggle, onSelectAll, onRefresh, onPush, onOpen, onCredentials }: {
  root: string; repositories: WorkspaceRepository[]; selected: Set<string>; working: boolean; blocked: boolean; layout: WorkspaceLayout;
  onToggle: (repo: string) => void; onSelectAll: () => void; onRefresh: () => void; onPush: () => void;
  onOpen: (entry: RepoEntry, hash?: string) => Promise<void>; onCredentials: (repo: WorkspaceRepository) => void;
}) {
  const { t } = useI18n(); const api = window.gitvista;
  const fileHistory = useFileHistory(root, layout.settings);
  const [scope, setScope] = useState(''), [commitKey, setCommitKey] = useState(''), [detail, setDetail] = useState<CommitDetail>();
  const [file, setFile] = useState<FileSelection>(), [allFiles, setAllFiles] = useState(true), [codeMode, setCodeMode] = useState(true);
  const [code, setCode] = useState<string | null>(null), [diff, setDiff] = useState<DiffResult | null>(null), [reading, setReading] = useState(false), [error, setError] = useState('');
  const [detailError, setDetailError] = useState(''), [split, setSplit] = useState(layout.settings.diffView === 'split');
  const [showDetails, setShowDetails] = useState(true), [logCommand, setLogCommand] = useState<LogCommand>();
  const [fileWidth, setFileWidth] = usePanelSize('fileWidth', 245, 130, 650);
  const [sideWidth, setSideWidth] = usePanelSize('dockRepositoryWidth', 240, 200, 420);
  const [historyRatio, setHistoryRatio] = usePanelSize('bottomHistoryRatio', .42, .22, .62);
  const [detailsWidth, setDetailsWidth] = usePanelSize('historyDetailsWidth', 300, 240, 560);
  const [size, setSize] = useState({ width: 1400, height: 800 }); const container = useRef<HTMLDivElement>(null);
  const [revision, setRevision] = useState(0);
  useEffect(() => { setRevision(value => value + 1); }, [repositories]);
  useEffect(() => { if (!container.current) return; const observer = new ResizeObserver(([entry]) => setSize({ width: entry.contentRect.width, height: entry.contentRect.height })); observer.observe(container.current); return () => observer.disconnect(); }, []);
  useEffect(() => { if (scope && !repositories.some(item => item.entry.path === scope)) setScope(''); }, [repositories, scope]);
  const relative = (repo: string) => relativeRepository(root, repo);
  const aggregate = useMemo(() => workspaceSnapshot(root, repositories), [root, repositories]);
  const query = useMemo(() => createWorkspaceLog(root, repositories, scope, (repo, request) => api.query(repo, request)), [root, repositories, scope, api]);
  const source: LogSource = useMemo(() => ({ query,
    commitLabel: key => relativeRepository(root, splitWorkspaceRef(key)?.repo || root),
    refLabel: key => { const value = splitWorkspaceRef(key); return value ? `${relativeRepository(root, value.repo)} · ${value.ref}` : key; },
    controls: <SelectMenu label={t('日志仓库筛选')} searchable value={scope} onChange={setScope} options={[{ value: '', label: t('全部仓库') }, ...repositories.map(item => ({ value: item.entry.path, label: relativeRepository(root, item.entry.path) }))]} />,
  }), [query, root, scope, repositories, t]);
  const commit = splitWorkspaceRef(commitKey);
  const activeRepository = repositories.find(item => item.entry.path === commit?.repo);
  const detailRequest = useRef(0), fileRequest = useRef(0);
  const selectCommit = async (key: string) => {
    const target = splitWorkspaceRef(key); if (!target) return;
    const id = ++detailRequest.current, chosenFile = ++fileRequest.current; setCommitKey(key); setDetail(undefined); setDetailError(''); setFile(undefined);
    try {
      const value = await api.query<CommitDetail>(target.repo, { type: 'commit', ref: target.ref });
      if (id !== detailRequest.current) return;
      setDetail(value);
      const first = value.files[0];
      if (first && chosenFile === fileRequest.current) { setFile({ path: workspaceFilePath(root, target.repo, first.path), repo: target.repo, relative: first.path, ref: target.ref, deleted: first.status.startsWith('D') }); setCodeMode(false); }
    } catch (cause) { if (id === detailRequest.current) setDetailError(String(cause)); }
  };
  useEffect(() => () => { ++detailRequest.current; }, []);
  useEffect(() => {
    let alive = true; setCode(null); setDiff(null); setError('');
    if (!file) { setReading(false); return; }
    setReading(true);
    const request = codeMode
      ? (file.ref || file.staged) && file.repo ? api.query<string>(file.repo, { type: 'fileContent', path: file.relative, ref: file.deleted ? detail?.commit.parents[0] : file.ref, staged: file.staged }) : api.workspaceFile(root, file.path)
      : file.repo ? api.query<DiffResult>(file.repo, { type: 'diff', ref: file.ref, path: file.relative, staged: file.staged }) : Promise.resolve({ text: '', binary: false, truncated: false });
    request.then(value => { if (alive) { if (typeof value === 'string') setCode(value); else setDiff(value); } }).catch(cause => { if (alive) setError(String(cause)); }).finally(() => { if (alive) setReading(false); });
    return () => { alive = false; };
  }, [root, file, codeMode, revision, api, detail]);
  const statuses = useMemo(() => new Map(repositories.flatMap(item => (item.snapshot?.files || []).map(value => [workspaceFilePath(root, item.entry.path, value.path), value.conflict ? '!' : (value.worktree.trim() || value.index.trim())] as const))), [root, repositories]);
  const owner = (path: string) => repositories.filter(item => { const prefix = relative(item.entry.path); return prefix === '.' || path.startsWith(prefix + '/'); }).sort((a, b) => b.entry.path.length - a.entry.path.length)[0];
  const workingFileHistory = (event: React.MouseEvent<HTMLButtonElement>, path: string) => {
    const item = owner(path); if (!item) return;
    const prefix = relative(item.entry.path);
    const relativePath = prefix === '.' ? path : path.slice(prefix.length + 1);
    const value = item.snapshot?.files.find(file => file.path === relativePath);
    fileHistory.context(event, { repo: item.entry.path, path: relativePath, oldPath: value?.index === 'R' || value?.worktree === 'R' ? value.oldPath : undefined });
  };
  const selectFile = (path: string) => {
    ++fileRequest.current;
    const item = owner(path); const prefix = item && relative(item.entry.path);
    setFile({ path, repo: item?.entry.path, relative: prefix === '.' ? path : prefix ? path.slice(prefix.length + 1) : undefined }); setCodeMode(true);
  };
  const changedFiles = useMemo(() => detail && commit ? detail.files.map(value => ({ ...value, path: workspaceFilePath(root, commit.repo, value.path) })) : [], [detail, commitKey, root]);
  const selectChanged = (path: string) => {
    ++fileRequest.current;
    if (!detail || !commit) return;
    const value = detail.files.find(value => workspaceFilePath(root, commit.repo, value.path) === path);
    if (value) { setFile({ path, repo: commit.repo, relative: value.path, ref: commit.ref, deleted: value.status.startsWith('D') }); setCodeMode(false); }
  };
  const historyHeight = clamp(size.height * historyRatio, 210, Math.max(210, size.height - 180));
  const renderedSide = Math.min(sideWidth, size.width * .3), mainWidth = size.width - 49 - (layout.sidebar ? renderedSide : 0);
  const renderedFiles = clamp(fileWidth, 130, Math.max(130, mainWidth - 280));
  const changedCount = repositories.reduce((count, item) => count + (item.snapshot?.files.length || 0), 0);
  const icon = (label: string, children: React.ReactNode, onClick: () => void, active = false) => <button className={`icon-button ${active ? 'active' : ''}`} title={label} aria-label={label} onClick={onClick}>{children}</button>;
  return <div className="workspace workspace-combined" ref={container} style={{ '--side-width': `${renderedSide}px` } as React.CSSProperties}>
    <nav className="icon-rail" aria-label={t('工具窗口')}>
      {icon(t('仓库与分支'), <FolderGit2 size={21} />, () => layout.onDock('repositories'), layout.sidebar && layout.dockTab === 'repositories')}
      {icon(t('本地变更'), <Files size={20} />, () => layout.onDock('changes'), layout.sidebar && layout.dockTab === 'changes')}
      <div className="rail-divider" />{icon(t('提交历史'), <History size={20} />, layout.onHistory, layout.historyOpen)}
    </nav>
    {layout.sidebar && <><aside className={`sidebar workspace-repositories ${layout.dockTab === 'changes' ? 'workspace-changes' : ''}`}>
      <div className="sidebar-title"><span>{t(layout.dockTab === 'repositories' ? '仓库与分支' : '本地变更')}</span><span className="small-badge">{layout.dockTab === 'repositories' ? repositories.length : changedCount}</span>{icon(t('重新扫描'), <RefreshCw size={14} className={working ? 'spin' : ''} />, onRefresh)}</div>
      {layout.dockTab === 'repositories' && <div className="workspace-repo-selection"><span>{t('批量操作仓库')}</span><button disabled={working} onClick={onSelectAll}>{t(repositories.length > 0 && selected.size === repositories.length ? '全不选' : '全选')}</button></div>}
      <div className="sidebar-scroll">{repositories.map(item => <details className="workspace-repository" key={item.entry.path} open data-repository={item.entry.path}>
        <summary><FolderGit2 size={14} /><span title={item.entry.path}>{relative(item.entry.path)}</span>{layout.dockTab === 'repositories' && <input type="checkbox" aria-label={`${t('选择')} ${relative(item.entry.path)}`} checked={selected.has(item.entry.path)} disabled={working} onClick={event => event.stopPropagation()} onChange={() => onToggle(item.entry.path)} />}</summary>
        {item.error && <p className="multi-repo-error">{item.error}</p>}
        {layout.dockTab === 'repositories' ? <>
          <div className="workspace-repo-actions"><button disabled={working} onClick={() => void onOpen(item.entry)}>{t('打开仓库')}<ArrowUpRight size={11} /></button><button disabled={working || !item.snapshot?.remotes.length} onClick={() => onCredentials(item)}>{t('仓库授权')}</button></div>
          <details className="workspace-refs" open><summary>{t('本地分支')}</summary>{item.snapshot?.branches.filter(branch => !branch.remote).map(branch => <button key={branch.name} className={branch.current ? 'current' : ''} onClick={() => { setScope(''); setLogCommand({ id: Date.now(), kind: 'branch', value: workspaceRef(item.entry.path, branch.name) }); }}><GitBranch size={12} /><span>{branch.name}</span>{branch.current && <i className="live-dot" />}</button>)}</details>
          <details className="workspace-refs"><summary>{t('远端分支')} · {item.snapshot?.branches.filter(branch => branch.remote).length || 0}</summary>{item.snapshot?.branches.filter(branch => branch.remote).map(branch => <button key={branch.name} onClick={() => { setScope(''); setLogCommand({ id: Date.now(), kind: 'branch', value: workspaceRef(item.entry.path, branch.name) }); }}><GitBranch size={12} /><span>{branch.name}</span></button>)}</details>
          <details className="workspace-refs"><summary>{t('远端')} · {item.snapshot?.remotes.length || 0}</summary>{item.snapshot?.remotes.map(remote => <div className="workspace-remote" key={remote.name} title={remote.fetch}>{remote.name}<small>{remote.fetch}</small></div>)}</details>
        </> : <>{item.snapshot?.files.map(value => <button className="workspace-change-file" key={value.path} title={workspaceFilePath(root, item.entry.path, value.path)} onContextMenu={event => workingFileHistory(event, workspaceFilePath(root, item.entry.path, value.path))} onClick={() => { ++fileRequest.current; setFile({ path: workspaceFilePath(root, item.entry.path, value.path), repo: item.entry.path, relative: value.path, staged: value.staged && !value.unstaged }); setCodeMode(false); }}><FileIcon path={value.path} /><span>{value.path}</span><i>{value.conflict ? '!' : value.worktree.trim() || value.index.trim()}</i></button>)}{!item.snapshot?.files.length && <p className="workspace-tree-notice">{t('没有本地更改')}</p>}</>}
      </details>)}{!repositories.length && <div className="empty-state"><FolderGit2 size={24} /><strong>{t('未发现 Git 仓库')}</strong><p>{t('将仓库放在此文件夹下，再点击重新扫描。普通父文件夹不会被自动初始化。')}</p><button disabled={working} onClick={() => void api.initRepository(root).then(entry => entry && onOpen(entry)).catch(cause => setDetailError(String(cause)))}>{t('初始化一个新仓库')}</button></div>}</div>
      {layout.dockTab === 'changes' && <button className="workspace-commit-all primary-button" disabled={working || !selected.size} onClick={onPush}>{t('提交并推送所选仓库')}</button>}
    </aside><ResizeHandle direction="vertical" label={t('调整侧栏宽度')} onResize={delta => setSideWidth(value => clamp(value + delta, 200, 420))} onReset={() => setSideWidth(240)} /></>}
    <main className="main-workspace">
      <section className="diff-panel"><div className="panel-heading"><div className="panel-tab"><Files size={15} />{t(file?.ref ? '历史代码' : '工作区代码')}<span>{root.split(/[\\/]/).pop()}</span></div><div className="panel-heading-actions"><div className="segmented"><button className={!codeMode ? 'active' : ''} disabled={!file?.repo} onClick={() => setCodeMode(false)}>{t('差异')}</button><button className={codeMode ? 'active' : ''} onClick={() => setCodeMode(true)}>{t('完整代码')}</button></div><div className="segmented"><button className={!split ? 'active' : ''} onClick={() => setSplit(false)}>{t('统一')}</button><button className={split ? 'active' : ''} onClick={() => setSplit(true)}>{t('并排')}</button></div></div></div>
        <div className="diff-body"><div className="commit-files" style={{ width: renderedFiles }}><div className="file-directory-heading"><FolderOpen size={14} /><strong>{t('文件目录')}</strong><span title={root}>{root.split(/[\\/]/).pop()}</span></div><div className="tree-mode"><button className={!allFiles ? 'active' : ''} disabled={!detail} onClick={() => setAllFiles(false)}>{t('改动文件')}</button><button className={allFiles ? 'active' : ''} onClick={() => setAllFiles(true)}>{t('全部文件')}</button></div>
          {allFiles ? <WorkspaceFileTree root={root} revision={revision} selected={file?.path} onSelect={selectFile} statuses={statuses} onContextMenu={workingFileHistory} /> : <FileTree files={changedFiles} selected={file?.path} onSelect={selectChanged} onContextMenu={(event, path) => { if (!commit || !detail) return; const value = detail.files.find(file => workspaceFilePath(root, commit.repo, file.path) === path); if (value) fileHistory.context(event, { repo: commit.repo, path: value.path, ref: commit.ref }); }} />}
        </div><ResizeHandle direction="vertical" label={t('调整文件目录与代码宽度')} onResize={delta => setFileWidth(value => clamp(value + delta, 130, Math.max(130, mainWidth - 240)))} onReset={() => setFileWidth(245)} /><div className="diff-content">
          {file && <div className="diff-filebar"><FileIcon path={file.path} size={14} /><span className="diff-file-path" title={file.path}>{file.path}</span><span className="diff-stage-label">{file.ref ? file.ref.slice(0, 8) : t('工作区')}</span></div>}
          {reading ? <div className="inline-loading"><Loader2 size={16} className="spin" />{t('读取代码…')}</div> : error ? <div className="soft-notice"><strong>{t('无法预览该文件')}</strong><p>{error}</p></div> : codeMode ? <CodeViewer text={code} path={file?.path} /> : <DiffViewer diff={diff} path={file?.path} split={split} wordWrap={layout.settings.wordWrap} fontSize={layout.settings.codeFontSize} />}
        </div></div>
      </section>
      {layout.historyOpen ? <><ResizeHandle direction="horizontal" label={t('调整提交历史高度')} onResize={delta => setHistoryRatio(value => clamp(value - delta / size.height, .22, .62))} onReset={() => setHistoryRatio(.42)} /><div className="history-dock" style={{ height: historyHeight }}>
        <LogPanel key={scope} repo={root} snapshot={aggregate} selected={commitKey} busy={working} blocked={blocked || fileHistory.isOpen} refreshing={working} source={source} command={logCommand} onSelect={key => void selectCommit(key)} onRefresh={onRefresh} onTool={() => {}} />
        {showDetails ? <><ResizeHandle direction="vertical" label={t('调整历史与提交详情宽度')} onResize={delta => setDetailsWidth(value => clamp(value - delta, 240, 560))} onReset={() => setDetailsWidth(300)} /><aside className="history-details" style={{ width: Math.min(detailsWidth, mainWidth * .38) }}><div className="panel-heading"><div className="panel-tab"><GitCommitHorizontal size={15} />{t('提交信息')}</div>{icon(t('收起提交信息'), <X size={14} />, () => setShowDetails(false))}</div>{detailError ? <p className="multi-repo-error">{detailError}</p> : detail && commit ? <><div className="workspace-detail-repo"><FolderGit2 size={13} /><span>{relative(commit.repo)}</span><button disabled={working} onClick={() => activeRepository && void onOpen(activeRepository.entry, commit.ref)} title={t('打开仓库')}><ArrowUpRight size={13} /></button></div><CommitDetails detail={detail} root={commit.repo} onBranch={branch => { setScope(''); setLogCommand({ id: Date.now(), kind: 'branch', value: workspaceRef(commit.repo, branch) }); }} onCopy={hash => void navigator.clipboard.writeText(hash).catch(cause => setDetailError(String(cause)))} /></> : <div className="empty-state"><GitCommitHorizontal size={28} /><strong>{t('选择一条提交记录')}</strong></div>}</aside></> : <button className="reopen-details" onClick={() => setShowDetails(true)}><PanelLeftClose size={14} /><span>{t('提交信息')}</span></button>}
      </div></> : <button className="reopen-history" onClick={layout.onHistory}><History size={14} />{t('提交历史')}</button>}
    </main>
    {fileHistory.overlay}
  </div>;
}
