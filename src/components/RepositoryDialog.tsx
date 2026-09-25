import { useEffect, useRef, useState } from 'react';
import { ArrowDownToLine, FolderOpen, KeyRound, Loader2, X } from 'lucide-react';
import type { GitRemote, RepoEntry, RepositoryCredentials } from '../../shared/types';
import { useI18n } from '../lib/i18n';
import SelectMenu from './SelectMenu';
import './repository-dialog.css';

export default function RepositoryDialog({ repo, remotes = [], onClose, onCloned, onBusy }: { repo?: string; remotes?: GitRemote[]; onClose: () => void; onCloned: (entry: RepoEntry) => Promise<void>; onBusy: (busy: string) => void }) {
  const { t } = useI18n();
  const [url, setUrl] = useState('');
  const [parent, setParent] = useState('');
  const [name, setName] = useState('');
  const [remote, setRemote] = useState(remotes[0]?.name || 'origin');
  const [auth, setAuth] = useState(repo ? 'token' : 'system');
  const [username, setUsername] = useState('');
  const [secret, setSecret] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    form.current?.querySelector<HTMLInputElement>('input')?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) { event.stopPropagation(); onClose(); }
      if (event.key === 'Tab') {
        const nodes = [...(form.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), [tabindex="0"]') || [])];
        const first = nodes[0], last = nodes[nodes.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    document.addEventListener('keydown', key, true);
    return () => { document.removeEventListener('keydown', key, true); before?.focus(); };
  }, [busy, onClose]);
  const credentials = (): RepositoryCredentials | undefined => auth === 'system' ? undefined : { username: username.trim() || (auth === 'token' ? 'oauth2' : ''), secret };
  const inferredName = name.trim() || url.trim().split(/[/:]/).pop()?.replace(/\.git$/, '') || 'repository';
  async function submit(event: React.FormEvent) {
    event.preventDefault(); if (busy) return;
    setBusy(true); setError(''); onBusy(t(repo ? '仓库授权' : '克隆仓库'));
    try {
      if (repo) { await window.gitvista.setRepositoryCredentials(repo, remote, credentials() || null); setSecret(''); onClose(); }
      else {
        const entry = await window.gitvista.cloneRepository(url.trim(), parent.trim(), name.trim() || undefined, credentials());
        if (entry) { setSecret(''); await onCloned(entry); onClose(); }
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); onBusy(''); }
  }
  return <div className="modal-backdrop"><form ref={form} className="simple-modal repository-dialog" role="dialog" aria-modal="true" aria-label={t(repo ? '仓库授权' : '克隆仓库')} onSubmit={submit}>
    <div className="repository-dialog-heading"><div><KeyRound size={18} /><h2>{t(repo ? '仓库授权' : '克隆仓库')}</h2></div><button type="button" className="icon-button" aria-label={t('关闭')} disabled={busy} onClick={onClose}><X size={18} /></button></div>
    <p className="tool-hint">{t(repo ? '为当前仓库的远端设置授权，供获取、拉取和推送使用。' : '从远程仓库下载代码，完成后自动打开。')}</p>
    {repo ? <label className="form-field"><span>{t('远端')}</span><SelectMenu label={t('远端')} value={remote} disabled={busy} onChange={setRemote} options={remotes.map(item => ({ value: item.name, label: item.name, description: item.fetch }))} /></label> : <>
      <label className="form-field"><span>{t('仓库地址')}</span><input required disabled={busy} value={url} onChange={e => setUrl(e.target.value)} placeholder="https://github.com/team/project.git" spellCheck={false} /></label>
      <label className="form-field"><span>{t('保存到父文件夹')}</span><div className="repository-path"><input aria-label={t('保存到父文件夹')} required disabled={busy} value={parent} onChange={e => setParent(e.target.value)} placeholder="D:\Projects" /><button type="button" className="secondary-button" disabled={busy} onClick={() => void window.gitvista.chooseDirectory().then(value => { if (value) setParent(value); }).catch(cause => setError(String(cause)))}><FolderOpen size={15} />{t('浏览')}</button></div></label>
      <label className="form-field"><span>{t('本地目录名（可选）')}</span><input disabled={busy} value={name} onChange={e => setName(e.target.value)} placeholder={t('默认使用仓库名称')} /></label>
      {parent && <p className="repository-destination">{t('目标目录')} <code>{parent.replace(/[\\/]$/, '')}\{inferredName}</code></p>}
    </>}
    <label className="form-field"><span>{t('授权方式')}</span><SelectMenu label={t('授权方式')} value={auth} disabled={busy} onChange={value => { setAuth(value); setSecret(''); }} options={[{ value: 'system', label: t('系统凭据 / SSH 密钥') }, { value: 'token', label: t('访问令牌（Token）') }, { value: 'password', label: t('用户名和密码') }]} /></label>
    {auth !== 'system' && <div className="repository-auth-fields">
      <label className="form-field"><span>{t(auth === 'token' ? '用户名（按服务商要求填写）' : '用户名')}</span><input required={auth === 'password'} disabled={busy} autoComplete="off" value={username} onChange={e => setUsername(e.target.value)} placeholder={auth === 'token' ? 'oauth2' : ''} /></label>
      <label className="form-field"><span>{t(auth === 'token' ? '访问令牌（Token）' : '密码')}</span><input type="password" required disabled={busy} autoComplete="new-password" value={secret} onChange={e => setSecret(e.target.value)} /></label>
    </div>}
    <p className="settings-help">{t(auth === 'system' ? '使用已配置的 Git 凭据或 SSH 密钥。选择此项可清除本次运行保存的仓库授权。' : '通过 HTTPS 授权，仅在本次运行期间保留。不会写入仓库地址或磁盘。服务商禁用账户密码时请使用 Token。')}</p>
    {error && <div className="modal-error" role="alert">{error}</div>}
    <div className="modal-actions"><button type="button" className="secondary-button" disabled={busy} onClick={onClose}>{t('取消')}</button><button className="primary-button" disabled={busy || (!!repo && !remotes.length)}>{busy ? <Loader2 size={16} className="spin" /> : <ArrowDownToLine size={16} />}{t(busy ? '正在处理…' : repo ? '应用授权' : '克隆并打开')}</button></div>
  </form></div>;
}
