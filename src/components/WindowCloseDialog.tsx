import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { AppWindow, Check, Clock3, Loader2, PanelBottom, Power, Settings2, X } from 'lucide-react';
import type { WindowClosePrompt, WindowCloseResponse } from '../../shared/types';
import { useI18n } from '../lib/i18n';
import './window-close-dialog.css';

export default function WindowCloseDialog() {
  const { t } = useI18n();
  const [prompt, setPrompt] = useState<WindowClosePrompt | null>(null);
  const [action, setAction] = useState<'tray' | 'quit'>('tray');
  const [remember, setRemember] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const dialog = useRef<HTMLDialogElement>(null);
  const submitting = useRef(false);
  const cancel = useRef(() => {});
  const id = useId();

  useEffect(() => {
    let alive = true, receivedEvent = false;
    const accept = (value: WindowClosePrompt | null) => {
      if (!alive) return;
      setPrompt(value); setError(''); setAction('tray'); setRemember(false);
    };
    const unsubscribe = window.gitvista.onWindowClosePrompt(value => { receivedEvent = true; accept(value); });
    // Recover a close request made before React mounted, or while the renderer reloaded.
    void window.gitvista.windowClosePrompt().then(value => { if (!receivedEvent) accept(value); }).catch(console.error);
    // Mounted before the workbench: underlying dialogs must not consume Escape or Tab.
    const keydown = (event: KeyboardEvent) => {
      if (!dialog.current?.open) return;
      event.stopImmediatePropagation();
      if (event.key === 'Escape') { event.preventDefault(); cancel.current(); }
    };
    window.addEventListener('keydown', keydown, true);
    return () => { alive = false; unsubscribe(); window.removeEventListener('keydown', keydown, true); };
  }, []);

  useLayoutEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (prompt && !element.open) {
      element.showModal();
      (element.querySelector<HTMLInputElement>('input[type="radio"]:checked') || element.querySelector<HTMLButtonElement>('button[type="submit"]'))?.focus({ preventScroll: true });
    }
    if (!prompt && element.open) element.close();
  }, [prompt]);

  const respond = async (choice: WindowCloseResponse['action']) => {
    if (!prompt || submitting.current) return;
    submitting.current = true; setPending(true); setError('');
    try { await window.gitvista.respondToWindowClose({ id: prompt.id, action: choice, remember: choice !== 'cancel' && remember }); }
    catch (failure) {
      const message = failure instanceof Error ? failure.message : String(failure);
      setError(message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, ''));
    } finally { submitting.current = false; setPending(false); }
  };
  cancel.current = () => { void respond('cancel'); };
  const busy = prompt?.kind === 'busy';

  return <dialog ref={dialog} className="window-close-dialog" aria-labelledby={`${id}-title`} aria-describedby={`${id}-description`} onCancel={event => { event.preventDefault(); cancel.current(); }}>
    {prompt && <form onSubmit={event => { event.preventDefault(); void respond(busy ? 'cancel' : action); }} aria-busy={pending}>
      <header className="window-close-heading">
        <div className="window-close-mark" aria-hidden="true">{busy ? <Clock3 size={23} /> : <AppWindow size={23} />}</div>
        <span className="window-close-brand">GitVista <span>· {t('窗口行为')}</span></span>
        <button className="window-close-cancel" type="button" aria-label={t('取消')} title={t('取消')} disabled={pending} onClick={() => void respond('cancel')}><X size={18} /></button>
      </header>
      <div className="window-close-content">
        <h2 id={`${id}-title`}>{t(busy ? '操作正在执行' : '关闭 GitVista')}</h2>
        <p className="window-close-description" id={`${id}-description`}>{t(busy ? '请等待当前 Git 操作或设置保存完成后关闭窗口。' : '选择退出，或在系统托盘中继续运行。')}</p>
        {!busy && <>
          <fieldset className="window-close-options" disabled={pending}>
            <legend className="window-close-sr-only">{t('点击关闭按钮时')}</legend>
            {(['tray', 'quit'] as const).map(value => <label key={value} className={`window-close-option ${action === value ? 'is-selected' : ''}`}>
              <span className="window-close-option-icon" aria-hidden="true">{value === 'tray' ? <PanelBottom size={21} /> : <Power size={21} />}</span>
              <span className="window-close-option-copy"><strong>{t(value === 'tray' ? '隐藏到系统托盘' : '退出软件')}</strong><small>{t(value === 'tray' ? '继续在后台运行，点击右下角托盘图标即可返回。' : '结束 GitVista 的所有窗口与后台进程。')}</small></span>
              <input type="radio" name={`${id}-action`} value={value} checked={action === value} aria-label={t(value === 'tray' ? '隐藏到系统托盘' : '退出软件')} autoFocus={value === 'tray'} onChange={() => setAction(value)} />
            </label>)}
          </fieldset>
          <div className="window-close-preference">
            <label className="window-close-remember"><span><input type="checkbox" checked={remember} disabled={pending} onChange={event => setRemember(event.target.checked)} /><Check size={12} aria-hidden="true" /></span>{t('以后不再提示')}</label>
            <p><Settings2 size={13} aria-hidden="true" />{t('可在「设置 → 常规」中随时更改')}</p>
          </div>
        </>}
        {error && <div className="window-close-error" role="alert">{error}</div>}
      </div>
      <footer className="window-close-actions">
        {!busy && <button type="button" className="window-close-secondary" disabled={pending} onClick={() => void respond('cancel')}>{t('取消')}</button>}
        <button type="submit" className="window-close-primary" disabled={pending} autoFocus={busy}>
          {pending ? <Loader2 size={15} className="spin" /> : !busy && (action === 'tray' ? <PanelBottom size={15} /> : <Power size={15} />)}
          {t(busy ? '继续等待' : action === 'tray' ? '隐藏到系统托盘' : '退出软件')}
        </button>
      </footer>
    </form>}
  </dialog>;
}
