import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUp, CheckCircle2, FolderGit2, Loader2, RefreshCw, X } from 'lucide-react';
import type { RepoEntry, WorkspaceBatch, WorkspaceOverview, WorkspaceProgress, WorkspacePushPlan, WorkspaceRepository } from '../../shared/types';
import { useI18n } from '../lib/i18n';
import RepositoryDialog from './RepositoryDialog';
import WorkspaceWorkbench, { type WorkspaceLayout } from './WorkspaceWorkbench';
import PushCommitFiles from './PushCommitFiles';
import PushFileDiff, { usePushFileDiff } from './PushFileDiff';
import FileIcon from './FileIcon';
import './workspace-panel.css';

export type WorkspaceCommand = { id: number; type: 'refresh' | 'fetch' | 'pull' | 'push' };
export default function WorkspacePanel({ root, command, onOpen, onBusy, layout }: { layout: WorkspaceLayout; root: string; command?: WorkspaceCommand; onOpen: (entry: RepoEntry, hash?: string) => Promise<void>; onBusy: (text: string) => void }) {
  const { t } = useI18n();
  const pushFile = usePushFileDiff();
  const [overview, setOverview] = useState<WorkspaceOverview>();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState('');
  const [working, setWorking] = useState(''), [results, setResults] = useState<Record<string, WorkspaceProgress>>({});
  const [pushOpen, setPushOpen] = useState(false), [includeChanges, setIncludeChanges] = useState(true), [plan, setPlan] = useState<WorkspacePushPlan>();
  const [message, setMessage] = useState(''), [credentials, setCredentials] = useState<WorkspaceRepository>();
  const active = useRef(false), mounted = useRef(true), loaded = useRef(false), latestCommand = useRef(0);
  const overviewRef = useRef(overview); overviewRef.current = overview;
  const begin = (label: string) => { active.current = true; setWorking(label); onBusy(label); setError(''); };
  const end = () => { active.current = false; if (mounted.current) setWorking(''); onBusy(''); };
  const load = useCallback(async () => {
    const value = await window.gitvista.workspaceOverview(root);
    if (!mounted.current) return value;
    const previous = overviewRef.current?.repositories || [];
    setSelected(current => {
      const allBefore = !loaded.current || previous.every(item => current.has(item.entry.path));
      return new Set(value.repositories.filter(item => allBefore || current.has(item.entry.path)).map(item => item.entry.path));
    });
    loaded.current = true; overviewRef.current = value; setOverview(value); return value;
  }, [root]);
  const refresh = async () => { if (active.current) return; begin(t('扫描子仓库…')); try { await load(); } catch (cause) { setError(String(cause)); } finally { end(); } };
  useEffect(() => {
    mounted.current = true; void refresh();
    const stop = window.gitvista.onWorkspaceProgress(progress => { if (progress.root === root && mounted.current) setResults(current => ({ ...current, [progress.repo]: progress })); });
    return () => { mounted.current = false; stop(); };
  }, [root]);
  const run = async (operation: WorkspaceBatch['operation']) => {
    if (active.current || (operation === 'push' && !selected.size)) return;
    begin(t(operation === 'push' ? '批量推送中…' : operation === 'pull' ? '批量拉取中…' : '批量获取中…')); setResults({});
    try {
      let paths = operation === 'push' ? ready.map(item => item.repo) : [...selected];
      if (operation !== 'push') {
        const previous = overviewRef.current?.repositories || [];
        const allBefore = previous.every(item => selected.has(item.entry.path));
        const latest = await load();
        paths = latest.repositories.filter(item => allBefore || selected.has(item.entry.path)).map(item => item.entry.path);
      }
      if (!paths.length) return;
      const completed = await window.gitvista.workspaceBatch(root, { operation, repos: paths, ...(operation === 'push' ? { planId: plan!.id, message } : {}) });
      setResults(Object.fromEntries(completed.map(item => [item.repo, item]))); setPushOpen(false); setPlan(undefined);
      await load();
    } catch (cause) { setError(String(cause)); if (operation === 'push') setPlan(undefined); }
    finally { end(); }
  };
  const preview = async (include = includeChanges) => {
    if (active.current || !selected.size) return;
    pushFile.clear(); setPushOpen(true); setPlan(undefined); setIncludeChanges(include); begin(t('生成批量推送预览…'));
    try { setPlan(await window.gitvista.workspacePushPreview(root, [...selected], include)); }
    catch (cause) { setError(String(cause)); }
    finally { end(); }
  };
  useEffect(() => {
    if (!command || !overview || working || latestCommand.current === command.id) return;
    latestCommand.current = command.id;
    if (command.type === 'refresh') void refresh(); else if (command.type === 'push') void preview(); else void run(command.type);
  }, [command, overview, working]);
  const repositories = useMemo(() => overview?.repositories || [], [overview]);
  const relative = (repo: string) => repo.slice(root.replace(/[\\/]$/, '').length + 1) || '.';
  const ready = plan?.items.filter(item => item.preview && !item.error && (item.files.length > 0 || item.preview.total > 0)) || [];
  const changed = ready.reduce((total, item) => total + item.files.length, 0);
  const toggle = (repo: string) => setSelected(current => { const next = new Set(current); if (next.has(repo)) next.delete(repo); else next.add(repo); return next; });
  const allSelected = repositories.length > 0 && selected.size === repositories.length;
  const summary = Object.values(results);
  return <main className="multi-workspace" aria-label={t('多仓库工作区')}>
    <div className="multi-summary workspace-summary"><FolderGit2 size={13} /><span title={root}>{root}</span><span>{t('{0} 个仓库', repositories.length)}</span><span>{t('{0} 个更改', repositories.reduce((total, item) => total + (item.snapshot?.files.length || 0), 0))}</span><button disabled={!!working} onClick={() => void refresh()}><RefreshCw size={12} />{t('重新扫描')}</button>{working && <strong role="status"><Loader2 size={13} className="spin" />{working}</strong>}</div>
    {error && <div className="multi-error" role="alert">{error}<button aria-label={t('关闭')} onClick={() => setError('')}><X size={14} /></button></div>}
    {overview?.scan.truncated && <div className="multi-warning">{t('扫描达到数量、深度或时间限制；可打开更具体的子目录继续。')}</div>}
    {!!overview?.scan.warnings.length && <details className="multi-warning"><summary>{t('部分目录无法读取')}</summary><pre>{overview.scan.warnings.join('\n')}</pre></details>}
    <WorkspaceWorkbench root={root} repositories={repositories} selected={selected} working={!!working} blocked={pushOpen || !!credentials} layout={layout} onToggle={toggle} onSelectAll={() => setSelected(allSelected ? new Set() : new Set(repositories.map(item => item.entry.path)))} onRefresh={() => void refresh()} onPush={() => void preview()} onOpen={onOpen} onCredentials={setCredentials} />
    {!!summary.length && <section className="multi-results" aria-label={t('批量操作结果')}><strong><CheckCircle2 size={14} />{t('批量操作结果')} · {t('成功')} {summary.filter(item => item.status === 'success').length} · {t('失败')} {summary.filter(item => item.status === 'failed').length}</strong><div>{summary.map(item => <details key={item.repo} open={item.status === 'failed'}><summary><span className={`multi-result-${item.status}`}>{t(item.status === 'running' ? '执行中' : item.status === 'success' ? '成功' : item.status === 'failed' ? '失败' : '已跳过')}</span> {relative(item.repo)} {item.commitHash && <code>{t('已创建本地提交')} {item.commitHash.slice(0, 8)}</code>}</summary><pre>{item.output}</pre></details>)}</div></section>}
    {pushOpen && <div className="modal-backdrop"><section className="multi-push-dialog" inert={pushFile.state?.open || undefined} role="dialog" aria-modal="true" aria-label={t('批量推送预览')}><header><h2>{t('批量推送预览')}</h2><button disabled={!!working} aria-label={t('关闭')} onClick={() => setPushOpen(false)}><X size={18} /></button></header><p>{t('核对各仓库的目标分支、提交和文件；失败仓库会单独报告，不回滚已完成的本地提交。')}</p><label className="multi-push-choice"><input type="checkbox" checked={includeChanges} disabled={!!working} onChange={event => void preview(event.target.checked)} />{t('包含未提交更改：先提交列出的文件，再推送')}</label><div className="multi-push-items">{working && !plan && <p role="status"><Loader2 size={16} className="spin" /> {working}</p>}{plan?.items.map(item => <details key={item.repo} open><summary><strong>{relative(item.repo)}</strong>{item.preview && <span>{item.preview.branch} → {item.preview.remote}/{item.preview.target}</span>}</summary>{item.error ? <p className="multi-repo-error">{item.error}</p> : <><p>{t('{0} 条待推送提交，{1} 个待提交文件', item.preview?.total || 0, item.files.length)}</p>{item.preview?.commits.map(commit => <PushCommitFiles key={`${item.repo}:${commit.hash}`} repo={item.repo} commit={commit} disabled={!!working} onFile={pushFile.select} />)}{!!item.files.length && <div className="multi-push-pending-label">{t('待提交更改')}</div>}{item.files.map(file => <button className="push-file" key={file.path} disabled={!!working} onClick={() => pushFile.select({ repo: item.repo, path: file.path, oldPath: file.oldPath, source: 'working' })}><FileIcon path={file.path} size={14} /><span>{file.path}</span><i>{file.index.trim() || file.worktree.trim()}</i></button>)}</>}</details>)}</div>{error && <p className="multi-repo-error" role="alert">{error}</p>}{changed > 0 && <label className="form-field"><span>{t('批量提交说明')}</span><textarea maxLength={50000} value={message} disabled={!!working} onChange={event => setMessage(event.target.value)} placeholder={t('为所有列出的文件填写提交说明')} /></label>}<footer><button disabled={!!working} onClick={() => setPushOpen(false)}>{t('取消')}</button><button disabled={!!working} onClick={() => void preview()}>{t('重新生成预览')}</button><button className="primary-button" disabled={!!working || !ready.length || (changed > 0 && !message.trim())} onClick={() => void run('push')}><ArrowUp size={14} />{t('推送 {0} 个仓库', ready.length)}</button></footer></section></div>}
    {pushOpen && pushFile.state?.open && <PushFileDiff state={pushFile.state} preferences={layout.settings} returnFocus={pushFile.opener.current} onClose={pushFile.close} onRetry={() => pushFile.state && pushFile.select(pushFile.state)} />}
    {credentials && <RepositoryDialog repo={credentials.entry.path} remotes={credentials.snapshot?.remotes} onClose={() => setCredentials(undefined)} onCloned={onOpen} onBusy={onBusy} />}
  </main>;
}
