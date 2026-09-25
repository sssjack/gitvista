import { useCallback, useEffect, useRef, useState } from 'react';
import { FileDiff, Loader2, RefreshCw, X } from 'lucide-react';
import type { AppPreferences, DiffResult } from '../../shared/types';
import { useI18n } from '../lib/i18n';
import DiffViewer from './DiffViewer';
import './push-review.css';

export type PushDiffTarget = { repo: string; path: string; oldPath?: string; source: 'commit' | 'staged' | 'working'; ref?: string; subject?: string };
export type PushDiffState = PushDiffTarget & { diff: DiffResult | null; loading: boolean; error: string; open: boolean };
export function usePushFileDiff() {
  const [state, setState] = useState<PushDiffState | null>(null);
  const request = useRef(0), mounted = useRef(true);
  const opener = useRef<HTMLElement | null>(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; ++request.current; }; }, []);
  const select = useCallback((file: PushDiffTarget) => {
    if (!document.querySelector('.push-file-diff-dialog')) opener.current = document.activeElement as HTMLElement | null;
    const id = ++request.current;
    setState({ ...file, diff: null, loading: true, error: '', open: true });
    void window.gitvista.query<DiffResult>(file.repo, { type: 'diff', path: file.path, oldPath: file.oldPath, ref: file.source === 'commit' ? file.ref : undefined, staged: file.source === 'staged', workingTree: file.source === 'working' }).then(diff => {
      if (mounted.current && id === request.current) setState(current => current && { ...current, diff, loading: false });
    }).catch(cause => {
      if (mounted.current && id === request.current) setState(current => current && { ...current, error: cause instanceof Error ? cause.message : String(cause), loading: false });
    });
  }, []);
  const clear = useCallback(() => { ++request.current; setState(null); }, []);
  const close = useCallback(() => setState(current => current && { ...current, open: false }), []);
  const reopen = useCallback(() => { opener.current = document.activeElement as HTMLElement | null; setState(current => current && { ...current, open: true }); }, []);
  return { state, select, clear, close, reopen, opener };
}

export function PushDiffContents({ state, preferences, split }: { state: PushDiffState; preferences: AppPreferences; split: boolean }) {
  const { t } = useI18n();
  return state.loading ? <div className="inline-loading"><Loader2 size={18} className="spin" />{t('读取差异…')}</div>
    : state.error ? <div className="push-diff-error" role="alert"><strong>{t('无法读取文件差异')}</strong><p>{state.error}</p></div>
    : <DiffViewer diff={state.diff} path={state.path} split={split} wordWrap={preferences.wordWrap} fontSize={preferences.codeFontSize} />;
}

export default function PushFileDiff({ state, preferences, onClose, onRetry, returnFocus }: { state: PushDiffState; preferences: AppPreferences; onClose: () => void; onRetry: () => void; returnFocus?: HTMLElement | null }) {
  const { t } = useI18n();
  const [split, setSplit] = useState(preferences.diffView === 'split');
  const dialog = useRef<HTMLElement>(null), closeButton = useRef<HTMLButtonElement>(null), closeRef = useRef(onClose); closeRef.current = onClose;
  useEffect(() => {
    const previous = returnFocus || document.activeElement as HTMLElement | null;
    closeButton.current?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); closeRef.current(); }
      else if (event.key === 'Tab') {
        const controls = [...(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), [tabindex="0"]') || [])].filter(node => node.getClientRects().length);
        const first = controls[0], last = controls[controls.length - 1];
        if (event.shiftKey && (document.activeElement === first || !dialog.current?.contains(document.activeElement))) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && (document.activeElement === last || !dialog.current?.contains(document.activeElement))) { event.preventDefault(); first?.focus(); }
      } else if ((event.ctrlKey || event.metaKey) && ['o', 'r', 'enter'].includes(event.key.toLowerCase())) { event.preventDefault(); event.stopImmediatePropagation(); }
    };
    window.addEventListener('keydown', keydown, true);
    return () => { window.removeEventListener('keydown', keydown, true); if (previous?.isConnected) previous.focus(); };
  }, []);
  const version = state.source === 'commit' ? state.ref?.slice(0, 8) : t(state.source === 'staged' ? '已暂存版本' : '待提交更改');
  return <div className="modal-backdrop push-diff-backdrop" onMouseDown={event => { if (event.currentTarget === event.target) onClose(); }}>
    <section ref={dialog} className="push-file-diff-dialog" role="dialog" aria-modal="true" aria-label={t('推送文件差异')}>
      <header><FileDiff size={17} /><strong>{t('文件差异')}</strong><span className="push-diff-path" title={state.oldPath ? `${state.oldPath} → ${state.path}` : state.path}>{state.oldPath ? `${state.oldPath} → ${state.path}` : state.path}</span><code>{version}</code>
        <div className="segmented"><button className={!split ? 'active' : ''} onClick={() => setSplit(false)}>{t('统一')}</button><button className={split ? 'active' : ''} onClick={() => setSplit(true)}>{t('并排')}</button></div>
        <button className="icon-button" title={t('重新读取差异')} aria-label={t('重新读取差异')} disabled={state.loading} onClick={onRetry}><RefreshCw size={15} /></button>
        <button ref={closeButton} className="icon-button" title={t('关闭文件差异')} aria-label={t('关闭文件差异')} onClick={onClose}><X size={18} /></button>
      </header>
      <div className="push-diff-context"><span title={state.repo}>{state.repo}</span>{state.subject && <span title={state.subject}>{state.subject}</span>}</div>
      <PushDiffContents state={state} preferences={preferences} split={split} />
    </section>
  </div>;
}
