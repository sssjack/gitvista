import SelectMenu from './SelectMenu';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDownUp, ArrowUpRight, CalendarDays, Check, ChevronDown, Eye, FilterX, GitBranch, GitCommitHorizontal, History, Loader2, MoreHorizontal, RefreshCw, Search, Tag, X, Zap } from 'lucide-react';
import type { GitCommit, GitLogOptions, GitLogResult, GitQuery, GitSnapshot } from '../../shared/types';
import CommitGraph from './CommitGraph';
import { buildCommitGraph } from '../lib/commit-graph';
import { useI18n } from '../lib/i18n';
import ResizeHandle from './ResizeHandle';
import { clampColumnWidth, LOG_COLUMN_LIMITS, LOG_COLUMNS_KEY, readLogColumnWidths } from '../lib/log-columns';
import type { LogColumn } from '../lib/log-columns';

export type LogCommand = { kind: 'branch' | 'locate'; value: string; id: number };
type ViewOptions = { author: boolean; date: boolean; hash: boolean; compactRefs: boolean; tagNames: boolean; refsRight: boolean; commitDate: boolean };
const DEFAULT_VIEW: ViewOptions = { author: true, date: true, hash: true, compactRefs: true, tagNames: true, refsRight: false, commitDate: false };
const LOG_ROW_HEIGHT = 30;
const EMPTY_FILTER: GitLogOptions = { text: '', branch: '', author: '', since: '', until: '', paths: [], regex: false, matchCase: false, order: 'topo', firstParent: false, noMerges: false };

function snapshotLogResult(snapshot: GitSnapshot, filter: GitLogOptions): GitLogResult | null {
  // 只有来源明确提供排序与分页元数据时才复用，不能把恰好 250 条误判为还有下一页。
  if (typeof snapshot.commitsHasMore !== 'boolean' || !snapshot.commitsOrder || snapshot.commitsOrder !== filter.order) return null;
  if (filter.text?.trim() || filter.branch || filter.author?.trim() || filter.since || filter.until || filter.paths?.length || filter.firstParent || filter.noMerges) return null;
  return { commits: snapshot.commits, hasMore: snapshot.commitsHasMore, nextSkip: snapshot.commits.length };
}

function commitAuthors(commits: GitCommit[]): string[] {
  return [...new Set(commits.map(commit => `${commit.author} <${commit.email}>`))];
}

function errorText(error: unknown) { return error instanceof Error ? error.message : String(error); }
function readView(): ViewOptions {
  try { const stored = JSON.parse(localStorage.getItem('gitvista.logView') || '{}') as Record<string, unknown>; return Object.fromEntries(Object.entries(DEFAULT_VIEW).map(([key, value]) => [key, typeof stored[key] === 'boolean' ? stored[key] : value])) as ViewOptions; }
  catch { return DEFAULT_VIEW; }
}

export interface LogSource { query: <T>(request: GitQuery) => Promise<T>; commitLabel: (hash: string) => string; refLabel: (ref: string) => string; controls?: React.ReactNode }

export default function LogPanel({ repo, snapshot, selected, busy, blocked, refreshing, command, inCurrentBranch, onSelect, onRefresh, onTool, source }: {
  repo: string; snapshot: GitSnapshot; selected?: string; busy: boolean; blocked: boolean; refreshing: boolean; command?: LogCommand; inCurrentBranch?: boolean;
  onSelect: (hash: string) => void; onRefresh: () => void; onTool: (tool: 'cherryPick' | 'revert' | 'tagCreate' | 'reset' | 'exportPatch' | 'reflog' | 'branchCreate' | 'writeCommitGraph', values?: Record<string, string | boolean>) => void;
  source?: LogSource;
}) {
  const [filter, setFilter] = useState<GitLogOptions>({ ...EMPTY_FILTER });
  const { t, locale } = useI18n();
  const shortDate = useCallback((value: string) => {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleString(locale, { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
  }, [locale]);
  const [view, setView] = useState(readView);
  const [columnWidths, setColumnWidths] = useState(readLogColumnWidths);
  const [viewportWidth, setViewportWidth] = useState(0);
  const [result, setResult] = useState<GitLogResult>(() => snapshotLogResult(snapshot, EMPTY_FILTER) || { commits: [], hasMore: false, nextSkip: 0 });
  const [loading, setLoading] = useState(false); const [error, setError] = useState(''); const [authors, setAuthors] = useState<string[]>([]);
  const [menu, setMenu] = useState<'sort' | 'view' | 'date' | 'paths' | 'more' | null>(null);
  const [locating, setLocating] = useState(false); const [locateOpen, setLocateOpen] = useState(false); const [locateText, setLocateText] = useState('');
  const [pathText, setPathText] = useState(''); const searchRef = useRef<HTMLInputElement>(null); const locateRef = useRef<HTMLInputElement>(null);
  const requestId = useRef(0); const locateId = useRef(0); const repoRef = useRef(repo); repoRef.current = repo;
  const resetRepoRef = useRef(repo); const debounceRef = useRef(false);
  const authorsRequest = useRef<{ repo: string; commits: GitCommit[]; pending: boolean; loaded: boolean } | null>(null);
  const rootRef = useRef<HTMLElement>(null); const headRef = useRef<HTMLDivElement>(null); const api = window.gitvista;
  const query = useCallback(<T,>(request: GitQuery) => source ? source.query<T>(request) : api.query<T>(repo, request), [api, repo, source]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const updateFilter = (patch: Partial<GitLogOptions>, typing = false) => { ++locateId.current; ++requestId.current; debounceRef.current = typing; setLocating(false); setFilter(current => ({ ...current, ...patch })); };
  const resetFilter = () => { ++locateId.current; ++requestId.current; debounceRef.current = false; setLocating(false); setFilter({ ...EMPTY_FILTER }); setPathText(''); };

  useEffect(() => { try { localStorage.setItem('gitvista.logView', JSON.stringify(view)); } catch { /* Display preferences are optional on read-only profiles. */ } }, [view]);
  useEffect(() => {
    const timer = setTimeout(() => { try { localStorage.setItem(LOG_COLUMNS_KEY, JSON.stringify(columnWidths)); } catch { /* Resizing still works when preferences cannot be saved. */ } }, 200);
    return () => clearTimeout(timer);
  }, [columnWidths]);
  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    const measure = () => setViewportWidth(scroller.clientWidth);
    const observer = new ResizeObserver(measure);
    observer.observe(scroller); measure();
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (resetRepoRef.current === repo) return;
    resetRepoRef.current = repo; debounceRef.current = false; authorsRequest.current = null; ++requestId.current; ++locateId.current;
    setFilter({ ...EMPTY_FILTER }); setResult(snapshotLogResult(snapshot, EMPTY_FILTER) || { commits: [], hasMore: false, nextSkip: 0 }); setAuthors([]); setError(''); setPathText(''); setMenu(null); setLocateOpen(false); setLocating(false);
  }, [repo]);
  const availableAuthors = useMemo(() => [...new Set([...commitAuthors(snapshot.commits), ...authors])], [snapshot.commits, authors]);
  const loadAuthors = () => {
    const previous = authorsRequest.current;
    if (previous?.repo === repo && previous.commits === snapshot.commits && (previous.pending || previous.loaded)) return;
    const request = { repo, commits: snapshot.commits, pending: true, loaded: false }; authorsRequest.current = request;
    void query<string[]>({ type: 'logAuthors' }).then(values => {
      if (authorsRequest.current === request && repo === repoRef.current) { request.loaded = true; setAuthors(values); }
    }).catch(() => { /* 快照中的作者仍可选择；再次聚焦时可以重试读取完整列表。 */ }).finally(() => { request.pending = false; });
  };
  useEffect(() => {
    const id = ++requestId.current; let alive = true; setError('');
    const cached = snapshotLogResult(snapshot, filter);
    if (cached) { debounceRef.current = false; setResult(cached); setLoading(false); return; }
    setLoading(true);
    const request = () => {
      debounceRef.current = false;
      query<GitLogResult>({ type: 'log', log: { ...filter, skip: 0, limit: 250 } }).then(data => { if (alive && id === requestId.current && repo === repoRef.current) setResult(data); }).catch(e => { if (alive && id === requestId.current) { setError(errorText(e)); setResult({ commits: [], hasMore: false, nextSkip: 0 }); } }).finally(() => { if (alive && id === requestId.current) setLoading(false); });
    };
    const timer = debounceRef.current ? setTimeout(request, 260) : undefined;
    if (timer === undefined) request();
    return () => { alive = false; if (timer !== undefined) clearTimeout(timer); };
  }, [repo, filter, snapshot.commits, snapshot.commitsHasMore, snapshot.commitsOrder, query]);
  const loadMore = async () => {
    if (loading || !result.hasMore) return;
    const id = requestId.current; const targetRepo = repo; setLoading(true);
    try { const next = await query<GitLogResult>({ type: 'log', log: { ...filter, skip: result.nextSkip, limit: 250 } }); if (id === requestId.current && targetRepo === repoRef.current) setResult(current => ({ ...next, commits: [...current.commits, ...next.commits.filter(commit => !current.commits.some(existing => existing.hash === commit.hash))] })); }
    catch (e) { if (id === requestId.current && targetRepo === repoRef.current) setError(errorText(e)); }
    finally { if (id === requestId.current && targetRepo === repoRef.current) setLoading(false); }
  };
  const locate = useCallback(async (value: string) => {
    if (!value.trim() || busy) return;
    const id = ++locateId.current; const targetRepo = repo; setLocating(true); setError('');
    try {
      const commit = await query<GitCommit>({ type: 'resolveRef', ref: value.trim() });
      if (id !== locateId.current || targetRepo !== repoRef.current) return;
      ++requestId.current; debounceRef.current = false; setFilter({ ...EMPTY_FILTER, branch: commit.hash }); setPathText(''); onSelect(commit.hash); setLocateOpen(false); setMenu(null);
    } catch (e) { if (id === locateId.current && targetRepo === repoRef.current) setError(errorText(e)); }
    finally { if (id === locateId.current) setLocating(false); }
  }, [query, repo, busy, onSelect]);
  useEffect(() => { if (!command) return; if (command.kind === 'branch') { updateFilter({ branch: command.value }); } else { setLocateText(command.value); void locate(command.value); } }, [command?.id]);
  useEffect(() => { if (!locateOpen) return; locateRef.current?.focus(); locateRef.current?.select(); }, [locateOpen]);
  useEffect(() => { if (!selected) return; rootRef.current?.querySelector<HTMLElement>(`[data-commit="${selected}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }, [selected, result]);
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (blocked || busy || !(event.ctrlKey || event.metaKey) || event.altKey) return;
      if (event.key.toLowerCase() === 'l') { event.preventDefault(); searchRef.current?.focus(); searchRef.current?.select(); }
      if (event.key.toLowerCase() === 'f') { event.preventDefault(); setLocateOpen(true); setMenu(null); }
    };
    const close = (event: PointerEvent) => { if (!rootRef.current?.contains(event.target as Node)) { setMenu(null); setLocateOpen(false); } };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { setMenu(null); setLocateOpen(false); } };
    window.addEventListener('keydown', keydown); window.addEventListener('pointerdown', close); window.addEventListener('keydown', escape);
    return () => { window.removeEventListener('keydown', keydown); window.removeEventListener('pointerdown', close); window.removeEventListener('keydown', escape); };
  }, [blocked, busy]);

  const commits = result.commits;
  const graphFiltered = !!(filter.text || filter.author || filter.since || filter.until || filter.paths?.length || filter.firstParent || filter.noMerges);
  const graph = useMemo(() => buildCommitGraph(
    filter.firstParent ? commits.map(commit => ({ ...commit, parents: commit.parents.slice(0, 1) })) : commits,
    { rowHeight: LOG_ROW_HEIGHT, laneWidth: 22, padding: 10, reserveMissingParents: !graphFiltered },
  ), [commits, filter.firstParent, graphFiltered]);
  const defaults: Record<LogColumn, number> = { graph: Math.max(64, graph.width), subject: 140, author: 95, date: 104, hash: 68 };
  const widths = { ...defaults, ...columnWidths };
  const visibleColumns: LogColumn[] = ['graph', 'subject', ...(view.author ? ['author' as const] : []), ...(view.date ? ['date' as const] : []), ...(view.hash ? ['hash' as const] : [])];
  const columns = visibleColumns.map(key => key === 'subject' && columnWidths.subject === undefined ? 'minmax(140px,1fr)' : `${widths[key]}px`).join(' ');
  const tableStyle = { '--log-columns': columns + (columnWidths.subject === undefined ? '' : ' minmax(0,1fr)'), '--log-min-width': `${20 + visibleColumns.reduce((total, key) => total + widths[key], 0)}px`, '--log-graph-width': `${widths.graph}px` } as React.CSSProperties;
  const resizeColumn = (column: LogColumn, delta: number) => {
    const subjectWidth = headRef.current?.querySelector<HTMLElement>('[data-log-column="subject"]')?.getBoundingClientRect().width || defaults.subject;
    // Freeze the flexible Subject column on the first resize so the divider
    // follows the pointer instead of being cancelled out by flex redistribution.
    setColumnWidths(current => ({ ...current, subject: current.subject ?? Math.round(subjectWidth), [column]: clampColumnWidth(column, (current[column] ?? (column === 'subject' ? subjectWidth : defaults[column])) + delta) }));
  };
  const resetColumn = (column: LogColumn) => setColumnWidths(current => { const next = { ...current }; delete next[column]; return next; });
  const columnLabels: Record<LogColumn, string> = { graph: t('分支图'), subject: t('提交说明列'), author: t('作者'), date: view.commitDate ? t('提交时间列') : t('创作时间列'), hash: t('提交列') };
  const header = (column: LogColumn) => <div className="log-column-header" data-log-column={column} key={column}>
    <span title={column === 'graph' ? t('双圈为合并提交；实线连接真实父提交；短虚线表示父提交在当前列表外') : columnLabels[column]}>{columnLabels[column]}</span>
    <ResizeHandle direction="vertical" label={t('调整{0}列宽', columnLabels[column])} title={t('拖动调整列宽；双击恢复默认；方向键微调')}
      value={column === 'subject' && columnWidths.subject === undefined ? Math.max(140, viewportWidth - 20 - visibleColumns.filter(key => key !== 'subject').reduce((total, key) => total + widths[key], 0)) : widths[column]}
      min={LOG_COLUMN_LIMITS[column].min} max={LOG_COLUMN_LIMITS[column].max} onResize={delta => resizeColumn(column, delta)} onReset={() => resetColumn(column)} />
  </div>;
  const parentSelect = (hash: string, missing: boolean) => {
    if (blocked || busy) return;
    if (missing) void locate(hash);
    else onSelect(hash);
  };
  const filtered = !!(filter.text || filter.branch || filter.author || filter.since || filter.until || filter.paths?.length || filter.firstParent || filter.noMerges);
  const toggleMenu = (next: typeof menu) => { setMenu(current => current === next ? null : next); setLocateOpen(false); };
  const tool = (id: Parameters<typeof onTool>[0]) => { setMenu(null); onTool(id, selected ? { ref: selected } : undefined); };
  const iconButton = (label: string, child: React.ReactNode, onClick: () => void, disabled = false) => <button type="button" className="icon-button" title={t(label)} aria-label={t(label)} onClick={onClick} disabled={disabled}>{child}</button>;
  const refs = (commit: GitCommit) => {
    const names = commit.refs ? commit.refs.split(', ') : []; const shown = view.compactRefs ? names.slice(0, 2) : names;
    return <span className={`commit-refs ${view.compactRefs ? 'compact' : ''}`}>{shown.map(ref => <span key={ref} title={ref} className={`ref-label ${ref.includes('HEAD') ? 'head-ref' : ''}`}>{ref.startsWith('tag: ') ? <Tag size={10} /> : <GitBranch size={10} />}{ref.startsWith('tag: ') && !view.tagNames ? '' : ref.replace('HEAD -> ', '').replace('tag: ', '')}</span>)}{view.compactRefs && names.length > 2 && <span className="ref-overflow" title={names.slice(2).join('\n')}>+{names.length - 2}</span>}</span>;
  };
  const row = (commit: GitCommit) => {
    const date = view.commitDate ? commit.committedDate || commit.date : commit.date;
    return <button className={`commit-row log-commit-row ${selected === commit.hash ? 'selected' : ''} ${view.refsRight ? 'refs-right' : ''}`} data-commit={commit.hash} style={tableStyle} key={commit.hash} title={commit.subject} disabled={blocked || busy || loading} onClick={() => onSelect(commit.hash)} onContextMenu={e => { e.preventDefault(); if (!blocked && !busy && !loading) { onSelect(commit.hash); if (!source) setMenu('more'); } }}>
      <span className="commit-graph-space" aria-hidden="true" />
      <span className="commit-subject">{source && <span className="workspace-commit-repo" title={source.commitLabel(commit.hash)}>{source.commitLabel(commit.hash)}</span>}{!view.refsRight && refs(commit)}<span className="commit-title">{commit.subject}</span>{view.refsRight && refs(commit)}</span>
      {view.author && <span className="commit-author" title={`${commit.author} <${commit.email}>`}><i aria-hidden="true">{commit.author.slice(0, 1).toUpperCase()}</i><span>{commit.author}</span></span>}
      {view.date && <span className="commit-date" title={date}>{shortDate(date)}</span>}{view.hash && <span className="commit-hash" title={source ? commit.hash.split('|').pop() : commit.hash}>{commit.short}</span>}
    </button>;
  };
  return <section className="history-panel log-panel" ref={rootRef} aria-label={t('Git 日志')} style={{ '--log-row-height': `${LOG_ROW_HEIGHT}px` } as React.CSSProperties}>
    <div className="panel-heading"><div className="panel-tab"><History size={15} />{t('提交历史')}<span>{commits.length}</span></div><div className="panel-heading-actions">
      {!source && <button type="button" className="icon-button" aria-label={t('加速日志查询')} title={`${t('加速日志查询')} · ${t('生成 Git 原生 commit-graph 缓存')}`} onClick={() => tool('writeCommitGraph')} disabled={busy}><Zap size={14} /></button>}
      {!source && iconButton('拣选选中提交', <GitCommitHorizontal size={15} />, () => tool('cherryPick'), !selected || busy || inCurrentBranch !== false)}
      {iconButton('刷新 · Ctrl+R', <RefreshCw size={14} className={loading || refreshing ? 'spin' : ''} />, onRefresh, busy || refreshing)}
      {iconButton('定位提交、分支或标签 · Ctrl+F', <Search size={15} />, () => { setLocateOpen(current => !current); setMenu(null); }, busy)}
      {iconButton('日志显示选项', <Eye size={15} />, () => toggleMenu('view'))}
      {!source && iconButton('更多日志操作', <MoreHorizontal size={17} />, () => toggleMenu('more'))}
    </div></div>
    <div className="log-toolbar"><div className="history-search"><Search size={14} /><input ref={searchRef} aria-label={t('搜索日志文本或哈希')} placeholder="Text or hash · Ctrl+L" value={filter.text || ''} onChange={e => updateFilter({ text: e.target.value }, true)} />{filter.text && iconButton('清空搜索', <X size={12} />, () => updateFilter({ text: '' }))}<button className={`search-option ${filter.regex ? 'active' : ''}`} title={t('正则表达式')} aria-label={t('正则表达式')} aria-pressed={!!filter.regex} onClick={() => updateFilter({ regex: !filter.regex })}>.*</button><button className={`search-option ${filter.matchCase ? 'active' : ''}`} title={t('区分大小写')} aria-label={t('区分大小写')} aria-pressed={!!filter.matchCase} onClick={() => updateFilter({ matchCase: !filter.matchCase })}>Cc</button></div>
      <div className="log-filter-controls">{source?.controls}<div className="log-select"><GitBranch size={12} /><SelectMenu label={t('日志分支筛选')} searchable searchPlaceholder={t('搜索分支…')} value={filter.branch || ''} onChange={value => updateFilter({ branch: value })} options={[{ value: '', label: `Branch · ${t('全部分支')}` }, { value: 'HEAD', label: `HEAD · ${t('当前分支')}` }, ...(filter.branch && filter.branch !== 'HEAD' && !snapshot.branches.some(branch => branch.name === filter.branch) ? [{ value: filter.branch, label: `${source ? source.refLabel(filter.branch) : filter.branch.slice(0, 12)} · ${t('定位提交')}` }] : []), ...snapshot.branches.map(branch => ({ value: branch.name, label: source ? source.refLabel(branch.name) : branch.name, group: branch.remote ? t('远端分支') : t('本地分支'), icon: <GitBranch size={14} /> }))]} /></div>
      <label className="log-author"><input aria-label={t('日志作者筛选')} placeholder={`User · ${t('作者或邮箱')}`} list="log-authors" value={filter.author || ''} onFocus={loadAuthors} onChange={e => updateFilter({ author: e.target.value }, true)} /><datalist id="log-authors">{availableAuthors.map(author => <option key={author} value={author} />)}</datalist></label>
      <button className={`log-filter-button ${filter.since || filter.until ? 'active' : ''}`} onClick={() => toggleMenu('date')} aria-label={t('日志日期筛选')}><CalendarDays size={12} />Date<ChevronDown size={11} /></button>
      <button className={`log-filter-button ${filter.paths?.length ? 'active' : ''}`} onClick={() => toggleMenu('paths')} aria-label={t('日志路径筛选')}>Paths{filter.paths?.length ? ` (${filter.paths.length})` : ''}<ChevronDown size={11} /></button>
      {iconButton('日志排序与合并过滤', <ArrowDownUp size={14} />, () => toggleMenu('sort'))}{filtered && iconButton('清除全部日志筛选', <FilterX size={14} />, resetFilter)}</div>
    </div>
    {locateOpen && <form className="log-locate" onSubmit={e => { e.preventDefault(); void locate(locateText); }}><Search size={14} /><input ref={locateRef} aria-label={t('定位引用')} placeholder={t('完整或短哈希、分支、标签，例如 HEAD~3')} value={locateText} onChange={e => setLocateText(e.target.value)} /><button type="submit" disabled={locating || !locateText.trim()}>{locating ? <Loader2 size={13} className="spin" /> : t('定位')}</button>{iconButton('关闭定位', <X size={13} />, () => setLocateOpen(false))}</form>}
    {menu && <div className={`log-popover log-popover-${menu}`} role="dialog" aria-label={menu === 'view' ? t('日志显示选项') : menu === 'sort' ? t('日志排序与合并过滤') : menu === 'date' ? t('日志日期筛选') : menu === 'paths' ? t('日志路径筛选') : t('选中提交')}>
      <div className="log-popover-title"><span>{menu === 'view' ? t('显示选项') : menu === 'sort' ? t('排序与过滤') : menu === 'date' ? t('按提交日期筛选') : menu === 'paths' ? t('限定文件或目录') : t('选中提交')}</span>{iconButton('关闭日志菜单', <X size={13} />, () => setMenu(null))}</div>
      {menu === 'view' && (Object.entries({ author: '显示作者列', date: '显示日期列', hash: '显示哈希列', compactRefs: '紧凑显示引用', tagNames: '显示标签名称', refsRight: '引用显示在说明右侧', commitDate: '显示提交时间（默认创作时间）' }) as [keyof ViewOptions, string][]).map(([key, label]) => <label className="log-check" key={key}><input type="checkbox" checked={view[key]} onChange={e => setView(current => ({ ...current, [key]: e.target.checked }))} />{t(label)}</label>)}
      {menu === 'view' && <button className="log-menu-item" disabled={!Object.keys(columnWidths).length} onClick={() => setColumnWidths({})}>{t('重置列宽')}</button>}
      {menu === 'sort' && <><label className="log-check"><input type="radio" name="log-sort" checked={filter.order === 'topo'} onChange={() => updateFilter({ order: 'topo' })} />{t('拓扑排序 · 保持分支相邻')}</label><label className="log-check"><input type="radio" name="log-sort" checked={filter.order === 'date'} onChange={() => updateFilter({ order: 'date' })} />{t('日期排序 · 按提交时间')}</label><hr /><label className="log-check"><input type="checkbox" checked={!!filter.firstParent} onChange={e => updateFilter({ firstParent: e.target.checked })} />{t('仅第一父提交')}</label><label className="log-check"><input type="checkbox" checked={!!filter.noMerges} onChange={e => updateFilter({ noMerges: e.target.checked })} />{t('隐藏合并提交')}</label></>}
      {menu === 'date' && <><label className="form-field"><span>{t('开始日期（含）')}</span><input type="date" aria-label={t('开始日期（含）')} value={filter.since || ''} onChange={e => updateFilter({ since: e.target.value })} /></label><label className="form-field"><span>{t('结束日期（含）')}</span><input type="date" aria-label={t('结束日期（含）')} value={filter.until || ''} onChange={e => updateFilter({ until: e.target.value })} /></label><button className="text-button" onClick={() => updateFilter({ since: '', until: '' })}>{t('清除日期')}</button></>}
      {menu === 'paths' && <form onSubmit={e => { e.preventDefault(); updateFilter({ paths: pathText.split(/\r?\n/).map(path => path.trim()).filter(Boolean) }); setMenu(null); }}><p>{t(source ? '每行一个父文件夹相对路径，文件夹会包含其下文件。' : '每行一个仓库相对路径，文件夹会包含其下文件。')}</p><textarea aria-label={t('日志路径列表')} placeholder={source ? 'project/src/\nproject/README.md' : 'src/\nREADME.md'} value={pathText} onChange={e => setPathText(e.target.value)} /><div className="log-popover-actions"><button type="button" onClick={() => { setPathText(''); updateFilter({ paths: [] }); setMenu(null); }}>{t('清除')}</button><button className="primary-button" type="submit"><Check size={12} />{t('应用路径')}</button></div></form>}
      {menu === 'more' && <>{([['cherryPick', '拣选选中提交'], ['revert', '还原选中提交'], ['tagCreate', '为提交创建标签'], ['reset', '重置到此提交'], ['exportPatch', '导出补丁'], ['reflog', '引用日志'], ['writeCommitGraph', '加速日志查询'], ['branchCreate', '全部 Git 操作']] as const).map(([id, label]) => <button className="log-menu-item" key={id} disabled={busy || (!selected && !['reflog', 'branchCreate', 'writeCommitGraph'].includes(id)) || (id === 'cherryPick' && inCurrentBranch !== false)} onClick={() => tool(id)}>{t(label)}<ArrowUpRight size={12} /></button>)}</>}
    </div>}
    {(error || result.warning) && <div className="log-error" role="alert">{error || result.warning}</div>}
    <div className="log-graph-help"><span><i className="graph-key-node" />{t('提交节点图例')}</span><span><i className="graph-key-edge" />{t('父提交图例')}</span><span title={t('父提交在当前列表外')}>{t('列表外')}</span></div>
    <div className="log-head-scroll" ref={headRef} style={{ width: viewportWidth || undefined }} onScroll={event => { if (scrollRef.current && scrollRef.current.scrollLeft !== event.currentTarget.scrollLeft) scrollRef.current.scrollLeft = event.currentTarget.scrollLeft; }}><div className="commit-table-head log-table-head" style={tableStyle}>{visibleColumns.map(header)}</div></div>
    <div className="commit-scroll" ref={scrollRef} aria-busy={loading} onScroll={event => { if (headRef.current && headRef.current.scrollLeft !== event.currentTarget.scrollLeft) headRef.current.scrollLeft = event.currentTarget.scrollLeft; }}>
      {!!commits.length && <div className="log-rows" style={tableStyle}>{commits.map(commit => row(commit))}<div className="log-graph-viewport"><CommitGraph graph={graph} commits={commits} selected={selected} disabled={blocked || busy || loading} onSelect={onSelect} onParent={parentSelect} onContext={hash => { onSelect(hash); if (!source) setMenu('more'); }} /></div></div>}
      {!commits.length && !loading && <div className="empty-state"><History size={27} /><strong>{filtered ? t('没有匹配的提交') : t('还没有提交')}</strong><p>{filtered ? t('调整筛选条件；搜索会查询仓库历史，而不局限于已加载记录。') : t('提交工作区更改后，历史会显示在这里。')}</p></div>}{loading && !commits.length && <div className="inline-loading"><Loader2 size={17} className="spin" />{t('查询仓库历史…')}</div>}{result.hasMore && <button className="load-more" disabled={loading} onClick={() => void loadMore()}>{t('加载更多提交')}</button>}
    </div>
    <div className="history-bottom"><span>{loading ? <Loader2 size={11} className="spin" /> : <span className="live-dot" />}{commits.length} {t('条提交')}{filtered && ` · ${t('已筛选')}`}{result.hasMore && ` · ${t('还有更多')}`}</span><span>{(filter.branch && source ? source.refLabel(filter.branch) : filter.branch) || t('所有分支')} · {filter.order === 'date' ? t('日期排序') : t('拓扑排序')}</span></div>
  </section>;
}
