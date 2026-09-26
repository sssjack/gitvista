import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { History, Loader2, RefreshCw, X } from 'lucide-react';
import type { AppPreferences, DiffResult, GitFileHistoryCommit } from '../../shared/types';
import { useI18n } from '../lib/i18n';
import DiffViewer from './DiffViewer';
import './file-history.css';

export type FileHistoryTarget = { repo: string; path: string; oldPath?: string; ref?: string };
type MenuTarget = { file: FileHistoryTarget; x: number; y: number; opener: HTMLElement };
const PAGE_SIZE = 100;

export function useFileHistory(scope: string, preferences: AppPreferences) {
  const [menu, setMenu] = useState<MenuTarget>();
  const [target, setTarget] = useState<FileHistoryTarget>();
  const opener = useRef<HTMLElement | null>(null);
  useEffect(() => { setMenu(undefined); setTarget(undefined); }, [scope]);
  const open = useCallback((file: FileHistoryTarget) => {
    opener.current = document.activeElement as HTMLElement | null;
    setMenu(undefined); setTarget(file);
  }, []);
  const context = useCallback((event: MouseEvent<HTMLElement>, file: FileHistoryTarget) => {
    event.preventDefault(); event.stopPropagation();
    const opener = event.currentTarget.querySelector<HTMLElement>('button') || event.currentTarget;
    opener.focus();
    const rect = event.currentTarget.getBoundingClientRect();
    setMenu({ file, x: event.clientX || rect.left, y: event.clientY || rect.bottom, opener });
  }, []);
  return { open, context, isOpen: !!target,
    overlay: <>
      {menu && <FileHistoryMenu key={`${menu.file.repo}:${menu.file.path}:${menu.x}:${menu.y}`} target={menu} onClose={() => setMenu(undefined)} onOpen={() => { opener.current = menu.opener; setMenu(undefined); setTarget(menu.file); }} />}
      {target && <FileHistoryDialog key={JSON.stringify(target)} target={target} preferences={preferences} returnFocus={opener.current} onClose={() => setTarget(undefined)} />}
    </>,
  };
}

function FileHistoryMenu({ target, onClose, onOpen }: { target: MenuTarget; onClose: () => void; onOpen: () => void }) {
  const { t } = useI18n();
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: target.x, top: target.y });
  const closeRef = useRef(onClose); closeRef.current = onClose;
  useLayoutEffect(() => {
    const rect = ref.current!.getBoundingClientRect();
    setPosition({ left: Math.max(8, Math.min(target.x, window.innerWidth - rect.width - 8)), top: Math.max(8, Math.min(target.y, window.innerHeight - rect.height - 8)) });
    ref.current?.querySelector('button')?.focus();
  }, [target]);
  useEffect(() => {
    const dismiss = () => closeRef.current();
    const outside = (event: PointerEvent) => { if (!ref.current?.contains(event.target as Node)) dismiss(); };
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape' || event.key === 'Tab') {
        event.preventDefault(); event.stopImmediatePropagation(); dismiss(); target.opener.focus();
      } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) event.preventDefault();
    };
    window.addEventListener('pointerdown', outside, true);
    window.addEventListener('keydown', key, true);
    window.addEventListener('resize', dismiss);
    window.addEventListener('blur', dismiss);
    window.addEventListener('scroll', dismiss, true);
    return () => {
      window.removeEventListener('pointerdown', outside, true); window.removeEventListener('keydown', key, true);
      window.removeEventListener('resize', dismiss); window.removeEventListener('blur', dismiss); window.removeEventListener('scroll', dismiss, true);
    };
  }, [target]);
  return createPortal(<div ref={ref} className="file-history-menu" role="menu" aria-label={t('文件操作')} style={position} onContextMenu={event => event.preventDefault()}>
    <div className="file-history-menu-path" title={target.file.path}>{target.file.path}</div>
    <button type="button" role="menuitem" onClick={onOpen}><History size={15} />{t('查看文件历史')}</button>
  </div>, document.body);
}

function FileHistoryDialog({ target, preferences, returnFocus, onClose }: { target: FileHistoryTarget; preferences: AppPreferences; returnFocus: HTMLElement | null; onClose: () => void }) {
  const { t, locale } = useI18n();
  const [commits, setCommits] = useState<GitFileHistoryCommit[]>([]), [selected, setSelected] = useState<GitFileHistoryCommit>();
  const [loading, setLoading] = useState(true), [error, setError] = useState(''), [hasMore, setHasMore] = useState(false);
  const [diff, setDiff] = useState<DiffResult | null>(null), [diffLoading, setDiffLoading] = useState(false), [diffError, setDiffError] = useState('');
  const [retry, setRetry] = useState(0), [split, setSplit] = useState(preferences.diffView === 'split');
  const dialog = useRef<HTMLElement>(null), closeButton = useRef<HTMLButtonElement>(null), requestId = useRef(0);
  const closeRef = useRef(onClose); closeRef.current = onClose;
  const load = async (skip = 0) => {
    const id = ++requestId.current; setLoading(true); setError('');
    try {
      const records = await window.gitvista.query<GitFileHistoryCommit[]>(target.repo, { type: 'fileHistory', path: target.path, oldPath: target.oldPath, ref: target.ref, limit: PAGE_SIZE + 1, log: { skip } });
      if (id !== requestId.current) return;
      const page = records.slice(0, PAGE_SIZE);
      setCommits(current => skip ? [...current, ...page] : page); setHasMore(records.length > PAGE_SIZE);
      if (!skip) setSelected(page[0]);
    } catch (cause) { if (id === requestId.current) setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { if (id === requestId.current) setLoading(false); }
  };
  useEffect(() => { void load(); return () => { ++requestId.current; }; }, []);
  useEffect(() => {
    let alive = true; setDiff(null); setDiffError(''); setDiffLoading(!!selected);
    if (selected) void window.gitvista.query<DiffResult>(target.repo, { type: 'diff', ref: selected.hash, path: selected.path, oldPath: selected.oldPath }).then(value => {
      if (alive) setDiff(value);
    }).catch(cause => { if (alive) setDiffError(cause instanceof Error ? cause.message : String(cause)); }).finally(() => { if (alive) setDiffLoading(false); });
    return () => { alive = false; };
  }, [selected, retry, target.repo]);
  useEffect(() => {
    closeButton.current?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); closeRef.current(); }
      else if (event.key === 'Tab') {
        const controls = [...(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), [tabindex="0"]') || [])].filter(node => node.getClientRects().length);
        const first = controls[0], last = controls[controls.length - 1];
        if (event.shiftKey && (document.activeElement === first || !dialog.current?.contains(document.activeElement))) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && (document.activeElement === last || !dialog.current?.contains(document.activeElement))) { event.preventDefault(); first?.focus(); }
      } else if (event.ctrlKey || event.metaKey) { event.stopImmediatePropagation(); if (['o', 'r', 'd', 'l', 'f', 'enter'].includes(event.key.toLowerCase())) event.preventDefault(); }
    };
    window.addEventListener('keydown', key, true);
    return () => { window.removeEventListener('keydown', key, true); if (returnFocus?.isConnected) returnFocus.focus(); };
  }, []);
  return createPortal(<div className="modal-backdrop file-history-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section ref={dialog} className="file-history-dialog" role="dialog" aria-modal="true" aria-label={t('文件历史')}>
      <header><History size={17} /><strong>{t('文件历史')}</strong><span title={target.path}>{target.path}</span><button ref={closeButton} className="icon-button" aria-label={t('关闭文件历史')} onClick={onClose}><X size={18} /></button></header>
      <div className="file-history-context"><span title={target.repo}>{target.repo}</span><span title={target.ref}>{target.ref ? t('截至提交 {0}', target.ref.slice(0, 8)) : t('当前分支 · HEAD')}</span></div>
      <div className="file-history-body">
        <div className="file-history-list" aria-label={t('文件提交记录')}>
          {commits.map(commit => <button key={commit.hash} className={`file-history-commit ${selected?.hash === commit.hash ? 'active' : ''}`} aria-pressed={selected?.hash === commit.hash} title={commit.subject} onClick={() => setSelected(commit)}>
            <strong>{commit.subject}</strong><span><code>{commit.short}</code><span>{commit.author}</span><time dateTime={commit.date}>{new Date(commit.date).toLocaleDateString(locale)}</time></span>
          </button>)}
          {loading && <div className="inline-loading" role="status"><Loader2 size={16} className="spin" />{t('查询仓库历史…')}</div>}
          {error && <div className="file-history-error" role="alert"><p>{error}</p><button onClick={() => void load(commits.length)}>{t('重试')}</button></div>}
          {!loading && !error && !commits.length && <div className="empty-state"><History size={26} /><strong>{t('没有文件历史')}</strong><p>{t('此文件在所选版本之前没有提交记录。')}</p></div>}
          {!loading && !error && hasMore && <button className="load-more" onClick={() => void load(commits.length)}>{t('加载更多提交')}</button>}
        </div>
        <div className="file-history-preview">
          {selected ? <><div className="file-history-diff-heading"><code>{selected.short}</code><span title={selected.path}>{selected.oldPath ? `${selected.oldPath} → ${selected.path}` : selected.path}</span><div className="segmented"><button className={!split ? 'active' : ''} onClick={() => setSplit(false)}>{t('统一')}</button><button className={split ? 'active' : ''} onClick={() => setSplit(true)}>{t('并排')}</button></div><button className="icon-button" aria-label={t('重新读取差异')} disabled={diffLoading} onClick={() => setRetry(value => value + 1)}><RefreshCw size={14} /></button></div>
            {diffLoading ? <div className="inline-loading"><Loader2 size={16} className="spin" />{t('读取差异…')}</div> : diffError ? <div className="file-history-error" role="alert">{diffError}</div> : <DiffViewer diff={diff} path={selected.path} split={split} wordWrap={preferences.wordWrap} fontSize={preferences.codeFontSize} />}</> : <div className="empty-state"><History size={26} /><strong>{t('选择一条提交记录')}</strong></div>}
        </div>
      </div>
    </section>
  </div>, document.body);
}
