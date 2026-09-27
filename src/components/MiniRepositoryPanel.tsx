import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowUp, Check, FileDiff, GitCommitHorizontal, Loader2, Maximize2, RefreshCw, X } from 'lucide-react';
import type { DesktopState, DiffResult, GitCommit, GitCommitFile, GitWorkingState, MiniAction, MiniQuery, PushPreview, RepoEntry } from '../../shared/types';
import { useI18n } from '../lib/i18n';
import { indexTextPages, readTextPage } from '../lib/text-pages';
import ResourcePager from './ResourcePager';

const api = window.gitvistaMini;
const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);
type DiffState = { query: MiniQuery; result?: DiffResult; error?: string };

function MiniDiffPreview({ text }: { text: string }) {
  const { t } = useI18n();
  const pages = useMemo(() => indexTextPages(text), [text]);
  const [pageIndex, setPageIndex] = useState(0);
  const code = useRef<HTMLPreElement>(null);
  useEffect(() => { setPageIndex(0); }, [text]);
  const current = Math.min(pageIndex, pages.length - 1);
  const page = pages[current];
  const lines = useMemo(() => readTextPage(text, page).split('\n'), [text, page]);
  const changePage = (next: number) => {
    setPageIndex(next);
    code.current?.closest('.mini-panel-body')?.scrollTo({ top: 0 });
  };
  return <>
    <ResourcePager page={current} pages={pages.length} onPage={changePage} label={`${t('补丁行')} ${page.firstLine}–${page.firstLine + page.lines - 1}`} />
    <pre ref={code} className="mini-diff-code">{text ? lines.map((line, index) => <span key={page.firstLine + index} data-patch-line={page.firstLine + index} title={`${t('补丁行')} ${page.firstLine + index}`} className={line.startsWith('+') ? 'added' : line.startsWith('-') ? 'removed' : ''}>{line || ' '}</span>) : t('没有差异')}</pre>
  </>;
}

function FileButton({ file, onClick, disabled }: { file: GitCommitFile; onClick: () => void; disabled: boolean }) {
  const { t } = useI18n();
  const label = file.oldPath ? `${file.oldPath} → ${file.path}` : file.path;
  return <button className="mini-file-link" title={label} disabled={disabled} onClick={onClick} aria-label={`${t('查看差异')} ${label}`}><FileDiff size={13} /><span>{label}</span><b data-status={file.status[0]}>{file.status}</b></button>;
}

function CommitFiles({ repo, commit, disabled, onFile }: { repo: string; commit: GitCommit; disabled: boolean; onFile: (query: MiniQuery) => void }) {
  const { t } = useI18n();
  const [files, setFiles] = useState<GitCommitFile[] | null>(null), [error, setError] = useState(''), [loading, setLoading] = useState(false);
  const pending = useRef(false);
  const load = async () => {
    if (pending.current) return;
    pending.current = true; setLoading(true); setError('');
    try { setFiles(await api.query<GitCommitFile[]>(repo, { type: 'commitFiles', ref: commit.hash })); }
    catch (cause) { setError(errorText(cause)); }
    finally { pending.current = false; setLoading(false); }
  };
  return <details className="mini-commit" onToggle={event => { if (event.currentTarget.open && !files && !error) void load(); }}>
    <summary title={commit.subject}><code>{commit.short}</code> {commit.subject}</summary>
    {loading && <p className="mini-empty">{t('读取提交文件…')}</p>}
    {error && <button className="mini-inline-error" title={error} onClick={() => void load()}>{t('读取文件列表失败，点击重试')}</button>}
    {files?.map(file => <FileButton key={file.path} file={file} disabled={disabled} onClick={() => onFile({ type: 'diff', path: file.path, oldPath: file.oldPath, ref: commit.hash })} />)}
    {files?.length === 0 && <p className="mini-empty">{t('此提交没有文件变更')}</p>}
  </details>;
}

export default function MiniRepositoryPanel({ state }: { state: DesktopState }) {
  const { t } = useI18n();
  const [repos, setRepos] = useState<RepoEntry[]>([]), [repo, setRepo] = useState('');
  const [tab, setTab] = useState<'changes' | 'push'>(state.panel || 'changes');
  const [working, setWorking] = useState<GitWorkingState>({ files: [], operation: '' });
  const [preview, setPreview] = useState<PushPreview | null>(null), [stale, setStale] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true), [acting, setActing] = useState(false);
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [output, setOutput] = useState('');
  const [message, setMessage] = useState(''), [diff, setDiff] = useState<DiffState | null>(null);
  const generation = useRef(0), diffGeneration = useRef(0), mutating = useRef(false);
  const closeButton = useRef<HTMLButtonElement>(null), diffOpener = useRef<HTMLElement | null>(null);
  const busy = acting || state.busy;
  const blocked = busy || loading;

  useEffect(() => {
    let active = true;
    void api.repositories(state.repo).then(entries => {
      if (active) { setRepos(entries); setRepo(entries[0]?.path || ''); setLoading(false); }
    }).catch(cause => { if (active) { setError(errorText(cause)); setLoading(false); } });
    closeButton.current?.focus();
    return () => { active = false; ++generation.current; ++diffGeneration.current; };
  }, [state.repo]);

  const load = useCallback(async () => {
    if (!repo) return;
    const id = ++generation.current;
    ++diffGeneration.current; setDiff(null); setLoading(true); setError(''); setStale(true); setPreview(null);
    try {
      const [status, plan] = await Promise.all([
        api.query<GitWorkingState>(repo, { type: 'status' }, 'mini:status'),
        tab === 'push' ? api.query<PushPreview>(repo, { type: 'pushPreview' }, 'mini:preview') : Promise.resolve(null),
      ]);
      if (id !== generation.current) return;
      setWorking(status); setPreview(plan); setStale(false);
      setSelected(current => new Set([...current].filter(path => status.files.some(file => file.path === path && (file.staged || file.unstaged) && !file.conflict))));
    } catch (cause) { if (id === generation.current) setError(errorText(cause)); }
    finally { if (id === generation.current) setLoading(false); }
  }, [repo, tab]);
  useEffect(() => { void load(); return () => { ++generation.current; ++diffGeneration.current; for (const key of ['mini:status', 'mini:preview', 'mini:diff']) api.cancelQuery(key); }; }, [load]);

  const closeDiff = useCallback(() => { ++diffGeneration.current; api.cancelQuery('mini:diff'); setDiff(null); requestAnimationFrame(() => diffOpener.current?.focus()); }, []);
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || busy) return;
      event.preventDefault();
      if (diff) closeDiff(); else void api.desktopCommand('closePanel');
    };
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  }, [busy, diff, closeDiff]);

  const viewDiff = async (query: MiniQuery) => {
    if (!diff) diffOpener.current = document.activeElement as HTMLElement;
    const id = ++diffGeneration.current; setDiff({ query });
    try {
      const result = await api.query<DiffResult>(repo, query, 'mini:diff');
      if (id === diffGeneration.current) setDiff({ query, result });
    } catch (cause) { if (id === diffGeneration.current) setDiff({ query, error: errorText(cause) }); }
  };
  const run = async (action: MiniAction) => {
    if (blocked || mutating.current || !repo) return;
    mutating.current = true; setActing(true); setError(''); setNotice(''); setOutput('');
    if (action.type === 'push') setStale(true);
    try {
      const result = await api.action(repo, action);
      setOutput(result.output);
      if (action.type === 'push') {
        setNotice(t('推送已完成'));
        if (action.commitStaged) setMessage('');
      } else {
        setNotice(t('本地提交已完成，可前往推送预览上传。'));
        setMessage(''); setSelected(new Set()); await load();
      }
    } catch (cause) {
      setError(errorText(cause) + (action.type === 'push' ? `\n${t('请重新读取推送内容后再执行；已完成的本地提交会保留。')}` : ''));
    } finally { mutating.current = false; setActing(false); }
  };
  const unstaged = working.files.filter(file => file.unstaged);
  const changes = working.files.filter(file => file.staged || file.unstaged || file.conflict);
  const selectable = changes.filter(file => !file.conflict);
  const commitReady = !blocked && !error && !!selected.size && !!message.trim() && !working.operation && !working.files.some(file => file.conflict);
  const commitSelected = () => {
    if (!commitReady) return;
    void run({ type: 'commit', message: message.trim(), commitFiles: selectable.filter(file => selected.has(file.path)).map(file => ({ path: file.path, source: file.unstaged ? 'workingTree' : 'index' })) });
  };
  const pushFiles = preview?.stagedFiles || [];
  const ready = !blocked && !stale && !!(preview?.head && preview.indexTree && preview.branch && preview.remote && preview.target && preview.stagedFiles)
    && !working.operation && !working.files.some(file => file.conflict) && (!!preview.total || !!pushFiles.length) && (!pushFiles.length || !!message.trim());
  const switchTab = (next: 'changes' | 'push') => { if (!blocked) { setTab(next); setDiff(null); setNotice(''); setOutput(''); } };

  return <section className="mini-panel" aria-label={t('迷你仓库面板')}>
    <header className="mini-panel-header"><GitCommitHorizontal size={16} /><strong>GitVista</strong><span>{t('迷你横条')}</span>
      <button title={t('打开主窗口')} aria-label={t('打开主窗口')} disabled={busy} onClick={() => void api.desktopCommand('restore')}><Maximize2 size={14} /></button>
      <button ref={closeButton} title={t('收起面板')} aria-label={t('收起面板')} disabled={busy} onClick={() => void api.desktopCommand('closePanel')}><X size={16} /></button>
    </header>
    <div className="mini-repo-picker"><select aria-label={t('仓库')} value={repo} disabled={blocked || repos.length < 2} title={repo} onChange={event => { setRepo(event.target.value); setMessage(''); setSelected(new Set()); setNotice(''); setOutput(''); }}>
      {!repos.length && <option value="">{t('未发现 Git 仓库')}</option>}
      {repos.map(entry => <option key={entry.path} value={entry.path}>{repos.length > 1 ? entry.path.replace(state.repo, '').replace(/^[\\/]/, '') || entry.name : entry.name}</option>)}
    </select><button aria-label={t('刷新文件与预览')} title={t('刷新文件与预览')} disabled={blocked || !repo} onClick={() => { setNotice(''); setOutput(''); void load(); }}><RefreshCw size={14} className={loading ? 'spin' : ''} /></button></div>
    <nav className="mini-panel-tabs" aria-label={t('仓库操作')}><button aria-pressed={tab === 'changes'} disabled={blocked} onClick={() => switchTab('changes')}><GitCommitHorizontal size={14} />{t('快捷提交')}</button><button aria-pressed={tab === 'push'} disabled={blocked} onClick={() => switchTab('push')}><ArrowUp size={14} />{t('推送预览')}</button></nav>
    <div className="mini-panel-body" aria-busy={loading}>
      {error && <div className="mini-panel-error" role="alert">{error}</div>}
      {notice && <div className="mini-panel-notice" role="status"><Check size={14} />{notice}</div>}
      {output && <details className="mini-operation-output"><summary>{t('操作输出')}</summary><pre>{output}</pre></details>}
      {loading ? <div className="mini-empty"><Loader2 size={18} className="spin" />{t('读取文件与预览…')}</div> : diff ? <div className="mini-diff">
        <div className="mini-diff-heading"><button autoFocus onClick={closeDiff}><ArrowLeft size={14} />{t('返回文件列表')}</button><button aria-label={t('重新读取差异')} onClick={() => void viewDiff(diff.query)}><RefreshCw size={14} /></button></div>
        <strong className="mini-diff-path">{diff.query.path}</strong>
        {diff.error ? <div role="alert" className="mini-panel-error">{diff.error}</div> : !diff.result ? <p className="mini-empty">{t('读取差异…')}</p> : diff.result.binary ? <p className="mini-empty">{t('二进制文件，无法显示文本差异')}</p> : <>
          {diff.result.truncated && <p className="mini-panel-hint">{t('差异过大，仅显示部分内容')}</p>}
          <MiniDiffPreview text={diff.result.text} />
        </>}
      </div> : !repo ? <p className="mini-empty">{t('请先打开仓库')}</p> : tab === 'changes' ? <>
        <div className="mini-section-heading"><strong>{t('待提交文件')} <span>{changes.length}</span></strong><button disabled={blocked || !selectable.length} onClick={() => setSelected(selected.size === selectable.length ? new Set() : new Set(selectable.map(file => file.path)))}>{t(selected.size === selectable.length && selectable.length ? '取消全选' : '全选')}</button></div>
        {changes.map(file => <div className="mini-file-row" key={file.path}><input type="checkbox" aria-label={`${t('选择提交文件')} ${file.path}`} checked={selected.has(file.path)} disabled={blocked || file.conflict} onChange={event => { const checked = event.target.checked; setSelected(current => { const next = new Set(current); if (checked) next.add(file.path); else next.delete(file.path); return next; }); }} /><FileButton file={{ ...file, status: file.conflict ? 'U' : (file.unstaged ? file.worktree : file.index).trim() || '?' }} disabled={busy} onClick={() => void viewDiff({ type: 'diff', path: file.path, oldPath: file.oldPath, workingTree: file.unstaged, staged: !file.unstaged })} /><span className="mini-file-source">{t(file.unstaged ? '工作区版本' : '暂存版本')}</span></div>)}
        {!changes.length && <p className="mini-empty">{t('没有待提交更改')}</p>}
        {!!changes.length && <p className="mini-panel-hint">{t('有未暂存改动的文件提交工作区版本；其余文件提交暂存版本。点击文件可查看完整差异。')}</p>}
        {working.files.some(file => file.conflict) && <p className="mini-panel-error">{t('请在主窗口解决冲突后继续。')}</p>}
        {!!working.operation && <p className="mini-panel-error">{t('请先在主窗口完成当前 Git 操作。')}</p>}
      </> : preview ? <>
        <div className="mini-push-target"><span>{preview.branch}</span><ArrowUp size={13} /><strong>{preview.remote}/{preview.target}</strong></div>
        <div className="mini-section-heading"><strong>{t('待推送提交')} <span>{preview.total}</span></strong></div>
        {preview.commits.map(commit => <CommitFiles key={`${repo}:${commit.hash}`} repo={repo} commit={commit} disabled={busy} onFile={query => void viewDiff(query)} />)}
        {!preview.total && <p className="mini-empty">{t('没有待推送的提交')}</p>}
        {preview.total > preview.commits.length && <p className="mini-panel-hint">{t('仅列出最近 {0} 条提交，推送包含全部待推送提交。', preview.commits.length)}</p>}
        <div className="mini-section-heading"><strong>{t('暂存区文件')} <span>{pushFiles.length}</span></strong></div>
        {pushFiles.map(file => <FileButton key={file.path} file={{ ...file, status: file.index }} disabled={busy} onClick={() => void viewDiff({ type: 'diff', path: file.path, oldPath: file.oldPath, staged: true, indexTree: preview.indexTree, base: preview.head })} />)}
        {!pushFiles.length && <p className="mini-empty">{t('没有暂存文件')}</p>}
        <p className="mini-panel-hint">{t('推送仅包含已有提交和以上暂存文件；未暂存更改不会提交。')}</p>
        {!!unstaged.length && <p className="mini-panel-hint">{t('{0} 个未暂存文件不在本次推送中。', unstaged.length)}</p>}
        {!!working.operation && <p className="mini-panel-error">{t('请先在主窗口完成当前 Git 操作。')}</p>}
      </> : null}
    </div>
    {!diff && <footer className="mini-panel-footer">
      {tab === 'changes' ? <>
        <label className="mini-message">{t('提交说明')}<textarea maxLength={50000} rows={2} value={message} disabled={blocked} placeholder={t('这次改动做了什么？')} onChange={event => setMessage(event.target.value)} onKeyDown={event => { if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); commitSelected(); } }} /></label>
        <span className="mini-commit-note">{t('已选择 {0} 个文件', selected.size)}<small>{t('仅提交到本地，不会自动推送')}</small></span><button className="mini-primary" title="Ctrl+Enter" disabled={!commitReady} onClick={commitSelected}>{acting ? <Loader2 size={14} className="spin" /> : <GitCommitHorizontal size={14} />}{t('提交所选文件')}</button>
      </> : <>
        {!!pushFiles.length && <label className="mini-message">{t('提交说明')}<textarea maxLength={50000} rows={2} value={message} disabled={blocked} placeholder={t('这次改动做了什么？')} onChange={event => setMessage(event.target.value)} /></label>}
        <button className="mini-primary" disabled={!ready} onClick={() => { if (ready && preview) void run({ type: 'push', expectedHead: preview.head, expectedIndexTree: preview.indexTree!, remote: preview.remote, ref: preview.branch, name: preview.target, commitStaged: !!pushFiles.length, message: message.trim() }); }}>{acting ? <Loader2 size={14} className="spin" /> : <ArrowUp size={14} />}{t(pushFiles.length ? '提交并推送' : '推送这一份')}</button>
      </>}
    </footer>}
  </section>;
}
