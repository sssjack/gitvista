import SelectMenu from './SelectMenu';
import { useEffect, useRef, useState } from 'react';
import { Check, ChevronRight, Code2, FolderOpen, GitBranch, Languages, Loader2, Monitor, Package, Palette, Save, Settings2, ShieldCheck, Terminal, UserRound, X } from 'lucide-react';
import { DEFAULT_PREFERENCES } from '../../shared/types';
import type { AppPreferences, AppSettings, AppTheme, GitIdentity, IdentityFields } from '../../shared/types';
import { useI18n } from '../lib/i18n';

export const THEMES: { value: AppTheme; name: string; detail: string; colors: string[] }[] = [
  { value: 'deep', name: '深黑', detail: '最深底色，接近 IDEA 深色', colors: ['#0b0c0e', '#121316', '#6f9fd8', '#6aa84f'] },
  { value: 'darcula', name: 'IDEA 深黑', detail: '更深背景、清晰对比', colors: ['#101114', '#17191d', '#a88bfa', '#6aab73'] },
  { value: 'dark', name: '石墨深色', detail: '安静、专注', colors: ['#16181d', '#1b1e24', '#7d95f5', '#62bd85'] },
  { value: 'light', name: '云白浅色', detail: '明亮、清晰', colors: ['#f7f8fa', '#ffffff', '#4a6cf0', '#1c8a55'] },
  { value: 'midnight', name: '午夜蓝', detail: '深邃、纯粹', colors: ['#101526', '#151b2e', '#7c9bf2', '#5fb8ac'] },
  { value: 'nord', name: '北欧极光', detail: '柔和、冷静', colors: ['#242933', '#2b313c', '#8fb0c9', '#93bf8a'] },
  { value: 'forest', name: '森林绿', detail: '自然、舒展', colors: ['#161d1b', '#1b2422', '#8fbfa4', '#6cbd8c'] },
  { value: 'rose', name: '暮光玫瑰', detail: '温润、细腻', colors: ['#1e191e', '#241e24', '#d499bf', '#96bd93'] },
];
const blankIdentity: GitIdentity = { local: { name: '', email: '' }, global: { name: '', email: '' }, effective: { name: '', email: '' } };
const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);
function preferencesOf(settings: AppSettings): AppPreferences {
  return { language: settings.language, theme: settings.theme, gitPath: settings.gitPath, pullStrategy: settings.pullStrategy, diffView: settings.diffView, codeFontSize: settings.codeFontSize, wordWrap: settings.wordWrap };
}

export default function SettingsDialog({ settings, repo, onSaved, onClose }: { settings: AppSettings; repo: string; onSaved: (settings: AppSettings) => void; onClose: () => void }) {
  const { t } = useI18n();
  const [tab, setTab] = useState<'git' | 'appearance'>('git');
  const [draft, setDraft] = useState<AppPreferences>(() => preferencesOf(settings));
  const [fontInput, setFontInput] = useState(String(settings.codeFontSize)); const dialogRef = useRef<HTMLElement>(null);
  const [identity, setIdentity] = useState<GitIdentity | null>(null);
  const [identityDrafts, setIdentityDrafts] = useState<{ local: IdentityFields; global: IdentityFields }>({ local: { ...blankIdentity.local }, global: { ...blankIdentity.global } });
  const [scope, setScope] = useState<'local' | 'global'>('local');
  const [identityLoading, setIdentityLoading] = useState(false);
  const [busy, setBusy] = useState(''); const [error, setError] = useState(''); const [identityError, setIdentityError] = useState(''); const [notice, setNotice] = useState('');
  const [gitTest, setGitTest] = useState<{ path: string; version?: string; error?: string } | null>(null);
  const mounted = useRef(true); const currentRepo = useRef(repo); currentRepo.current = repo; const identityRequest = useRef(0); const pathRequest = useRef(0);
  const api = window.gitvista;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; ++identityRequest.current; ++pathRequest.current; }; }, []);
  useEffect(() => {
    const id = ++identityRequest.current; const requestRepo = repo; setIdentity(null); setIdentityError(''); setIdentityDrafts({ local: { ...blankIdentity.local }, global: { ...blankIdentity.global } });
    if (!requestRepo) { setIdentityLoading(false); return; }
    setIdentityLoading(true);
    api.getGitIdentity(requestRepo).then(value => {
      if (!mounted.current || id !== identityRequest.current || currentRepo.current !== requestRepo) return;
      setIdentity(value); setIdentityDrafts({ local: { ...value.local }, global: { ...value.global } });
    }).catch(error => { if (mounted.current && id === identityRequest.current && currentRepo.current === requestRepo) setIdentityError(errorText(error)); }).finally(() => { if (mounted.current && id === identityRequest.current) setIdentityLoading(false); });
    return () => { ++identityRequest.current; };
  }, [repo, api, settings.gitPath]);
  useEffect(() => { const listener = (event: KeyboardEvent) => { if (document.querySelector('.select-menu-popup')) return; if (event.key === 'Tab') { const elements = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]') || []).filter(element => element.offsetParent !== null); const first = elements[0]; const last = elements[elements.length - 1]; if (first && last && ((event.shiftKey && document.activeElement === first) || (!event.shiftKey && document.activeElement === last) || !dialogRef.current?.contains(document.activeElement))) { event.preventDefault(); (event.shiftKey ? last : first).focus(); } } if (event.key === 'Escape') { event.stopImmediatePropagation(); if (!busy) onClose(); } }; window.addEventListener('keydown', listener, true); return () => window.removeEventListener('keydown', listener, true); }, [busy, onClose]);

  const changeGitPath = (path: string) => { ++pathRequest.current; setDraft(d => ({ ...d, gitPath: path })); setGitTest(null); };
  const browseGitPath = async () => { setBusy('browse'); setError(''); try { const path = await api.browseGitPath(); if (mounted.current && path) changeGitPath(path); } catch (e) { if (mounted.current) setError(errorText(e)); } finally { if (mounted.current) setBusy(''); } };
  const testGitPath = async () => {
    const path = draft.gitPath.trim() || 'git'; const id = ++pathRequest.current; setBusy('test'); setGitTest(null); setError('');
    try { const result = await api.testGitPath(path); if (mounted.current && id === pathRequest.current) setGitTest({ path, version: result.version }); }
    catch (e) { if (mounted.current && id === pathRequest.current) setGitTest({ path, error: errorText(e) }); }
    finally { if (mounted.current) setBusy(''); }
  };
  const savePreferences = async () => {
    setBusy('preferences'); setError(''); setNotice('');
    try { const value = await api.updatePreferences({ ...draft, gitPath: draft.gitPath.trim() || 'git' }); if (!mounted.current) return; setDraft(preferencesOf(value)); setFontInput(String(value.codeFontSize)); onSaved(value); setNotice('应用设置已保存并生效。'); }
    catch (e) { if (mounted.current) setError(errorText(e)); }
    finally { if (mounted.current) setBusy(''); }
  };
  const saveIdentity = async () => {
    const requestRepo = repo; const requestScope = scope; if (!requestRepo || !identity || requestRepo !== currentRepo.current) return;
    const id = ++identityRequest.current; setBusy('identity'); setIdentityError(''); setNotice('');
    try {
      const value = await api.setGitIdentity(requestRepo, { scope: requestScope, name: identityDrafts[requestScope].name.trim(), email: identityDrafts[requestScope].email.trim() });
      if (!mounted.current || id !== identityRequest.current || currentRepo.current !== requestRepo) return;
      setIdentity(value); setIdentityDrafts(d => ({ ...d, [requestScope]: { ...value[requestScope] } })); setNotice(requestScope === 'local' ? t('当前仓库的提交身份已保存。') : t('全局提交身份已保存。'));
    } catch (e) { if (mounted.current && id === identityRequest.current && currentRepo.current === requestRepo) setIdentityError(errorText(e)); }
    finally { if (mounted.current) setBusy(''); }
  };
  const identityDirty = !!identity && (identityDrafts[scope].name !== identity[scope].name || identityDrafts[scope].email !== identity[scope].email);
  const preferencesDirty = JSON.stringify(draft) !== JSON.stringify(preferencesOf(settings));
  const initialGitPath = settings.gitPath || 'git';

  return <div className="modal-backdrop settings-backdrop" onMouseDown={e => { if (e.target === e.currentTarget && !busy) onClose(); }}>
    <section ref={dialogRef} className="settings-dialog" role="dialog" aria-modal="true" aria-label={t('应用设置')}>
      <header className="settings-header"><div><span className="settings-brand"><Settings2 size={20} /></span><span><strong>{t('应用设置')}</strong><small>{t('打造顺手的 Git 工作环境')}</small></span></div><button type="button" className="icon-button" title={t('关闭设置')} aria-label={t('关闭设置')} onClick={onClose} disabled={!!busy}><X size={19} /></button></header>
      <div className="settings-body"><nav className="settings-nav" aria-label={t('偏好设置')}><span>{t('偏好设置')}</span><button autoFocus className={tab === 'git' ? 'active' : ''} onClick={() => setTab('git')}><GitBranch size={16} /><span>{t('Git 与提交')}</span><ChevronRight size={12} /></button><button className={tab === 'appearance' ? 'active' : ''} onClick={() => setTab('appearance')}><Palette size={16} /><span>{t('外观与差异')}</span><ChevronRight size={12} /></button><div className="settings-nav-bottom"><kbd>Ctrl</kbd><kbd>Alt</kbd><kbd>S</kbd><p>{t('随时打开设置')}</p></div></nav>
        <div className="settings-content">
          {tab === 'git' ? <>
            <div className="settings-page-title"><h2>{t('Git 与提交')}</h2><p>{t('连接本机 Git，设置提交身份与默认拉取方式。')}</p></div>
            <section className="settings-section"><h3><Package size={15} />{t('内置 Git')}</h3><div className="settings-bundled"><ShieldCheck size={15} /><span>{t('此版本内置 Git，无需单独安装。填写 git 会优先使用内置版本；也可以在下方指定本机已安装的 Git。')}</span></div></section>
            <section className="settings-section"><h3><Terminal size={15} />{t('Git 可执行文件')}</h3><label className="form-field"><span>{t('Git 路径')}</span><div className="settings-path"><input aria-label={t('Git 路径')} spellCheck={false} placeholder="git" value={draft.gitPath} onChange={e => changeGitPath(e.target.value)} disabled={!!busy} /><button className="secondary-button" type="button" disabled={!!busy} onClick={() => void browseGitPath()} title={t('浏览')}><FolderOpen size={14} />{t('浏览')}</button><button className="secondary-button" type="button" disabled={!!busy} onClick={() => void testGitPath()}>{busy === 'test' ? <Loader2 className="spin" size={14} /> : <Terminal size={14} />}{t('测试')}</button></div></label><p className="settings-help">{t('填写 git 使用系统 PATH，或选择 git.exe 的完整路径。保存后用于后续 Git 操作。')}</p>{gitTest && <div className={`settings-test ${gitTest.error ? 'failed' : 'success'}`}>{gitTest.error ? <X size={14} /> : <Check size={14} />}<span>{gitTest.error || gitTest.version}</span></div>}</section>
            <section className="settings-section identity-section"><h3><UserRound size={15} />{t('提交身份')}</h3>{!repo ? <div className="settings-empty"><FolderOpen size={20} /><span>{t('打开一个仓库后，可查看与设置提交身份。')}</span></div> : <><div className="settings-current-repo" title={repo}><FolderOpen size={12} /><span>{repo}</span></div><div className="identity-effective"><span>{t('当前有效身份')}</span>{identityLoading ? <span><Loader2 className="spin" size={12} />{t('读取中…')}</span> : identity ? <strong>{identity.effective.name || t('未设置姓名')} <small>〈{identity.effective.email || t('未设置邮箱')}〉</small></strong> : <span>{t('尚未读取成功')}</span>}</div><div className="identity-scope" role="group" aria-label={t('身份配置范围')}><button className={scope === 'local' ? 'active' : ''} disabled={!!busy || identityLoading} onClick={() => setScope('local')}>{t('当前仓库')} <span>Local</span></button><button className={scope === 'global' ? 'active' : ''} disabled={!!busy || identityLoading} onClick={() => setScope('global')}>{t('全局配置')} <span>Global</span></button></div><p className="identity-scope-hint">{scope === 'local' ? t('只影响当前仓库；字段留空会移除本地配置，继承全局或其他上级配置。') : t('影响本机使用此全局配置的仓库；仓库本地设置优先。字段留空会移除对应全局配置。')}</p><div className="identity-fields"><label className="form-field"><span>{t('提交者姓名')}</span><input aria-label={t('提交者姓名')} placeholder={scope === 'local' ? identity?.global.name || t('继承上级配置') : t('未设置姓名')} value={identityDrafts[scope].name} disabled={!!busy || !identity || identityLoading} onChange={e => setIdentityDrafts(d => ({ ...d, [scope]: { ...d[scope], name: e.target.value } }))} /></label><label className="form-field"><span>{t('提交者邮箱')}</span><input aria-label={t('提交者邮箱')} spellCheck={false} placeholder={scope === 'local' ? identity?.global.email || t('继承上级配置') : t('未设置邮箱')} value={identityDrafts[scope].email} disabled={!!busy || !identity || identityLoading} onChange={e => setIdentityDrafts(d => ({ ...d, [scope]: { ...d[scope], email: e.target.value } }))} /></label></div><div className="identity-save-row"><span><ShieldCheck size={12} />{t('独立保存，不随应用设置一起修改')}</span><button className="secondary-button" type="button" disabled={!!busy || !identity || !identityDirty} onClick={() => void saveIdentity()}>{busy === 'identity' ? <Loader2 className="spin" size={14} /> : <Save size={14} />}{scope === 'local' ? t('保存仓库身份') : t('保存全局身份')}</button></div>{initialGitPath !== draft.gitPath && <p className="settings-help">{t('身份信息使用当前已保存的 Git 路径读取；如要更换 Git，请先保存应用设置。')}</p>}</>}{identityError && <div className="modal-error">{identityError}</div>}</section>
            <section className="settings-section"><h3><GitBranch size={15} />{t('默认拉取策略')}</h3><label className="form-field"><span>{t('工具栏“拉取”使用')}</span><SelectMenu label={t('默认拉取策略')} value={draft.pullStrategy} disabled={!!busy} onChange={value => setDraft(d => ({ ...d, pullStrategy: value as AppPreferences['pullStrategy'] }))} options={[{ value: 'ff-only', label: t('仅快进（ff-only）') }, { value: 'merge', label: t('合并（merge）') }, { value: 'rebase', label: t('变基（rebase）') }]} /></label><p className="settings-help">{draft.pullStrategy === 'ff-only' ? t('仅在能够快进时更新；本地与远端分叉时停止，保留你的处理选择。') : draft.pullStrategy === 'merge' ? t('拉取后合并远端提交；存在分叉时可能生成合并提交。') : t('将本地提交重放到远端新提交之后；会改写这些本地提交的哈希。')}</p></section>
          </> : <>
            <div className="settings-page-title"><h2>{t('外观与差异')}</h2><p>{t('用熟悉的色彩与阅读方式，专注每一行变化。')}</p></div>
            <section className="settings-section"><h3><Languages size={15} />{t('界面语言')}</h3><label className="form-field"><span>{t('界面语言')}</span><SelectMenu label={t('界面语言')} value={draft.language} disabled={!!busy} onChange={value => setDraft(d => ({ ...d, language: value as AppPreferences['language'] }))} options={[{ value: 'en', label: t('英文') }, { value: 'zh', label: t('中文') }]} /></label><p className="settings-help">{t('切换界面语言，所有菜单与提示会立即更新。')}</p></section>
            <section className="settings-section"><h3><Palette size={15} />{t('界面主题')}</h3><div className="theme-grid" role="group" aria-label={t('界面主题')}>{THEMES.map(theme => <button className={`theme-card ${draft.theme === theme.value ? 'selected' : ''}`} key={theme.value} disabled={!!busy} aria-pressed={draft.theme === theme.value} onClick={() => setDraft(d => ({ ...d, theme: theme.value }))}><div className="theme-preview" style={{ background: theme.colors[0] }}><div style={{ background: theme.colors[1] }} /><span style={{ background: theme.colors[2] }} /><span style={{ background: theme.colors[3] }} /><i style={{ background: theme.colors[2] }} />{draft.theme === theme.value && <b style={{ background: theme.colors[2], color: theme.colors[0] }}><Check size={11} /></b>}</div><span>{t(theme.name)}</span><small>{t(theme.detail)}</small></button>)}</div></section>
            <section className="settings-section"><h3><Code2 size={15} />{t('代码阅读')}</h3><div className="settings-two-columns"><label className="form-field"><span>{t('默认差异视图')}</span><SelectMenu label={t('默认差异视图')} value={draft.diffView} disabled={!!busy} onChange={value => setDraft(d => ({ ...d, diffView: value as AppPreferences['diffView'] }))} options={[{ value: 'split', label: t('并排比较') }, { value: 'unified', label: t('统一比较') }]} /></label><label className="form-field"><span>{t('代码字号')}</span><div className="settings-number"><input aria-label={t('代码字号')} type="number" min="10" max="22" step="1" value={fontInput} disabled={!!busy} onChange={e => { setFontInput(e.target.value); const value = Number(e.target.value); if (Number.isInteger(value) && value >= 10 && value <= 22) setDraft(d => ({ ...d, codeFontSize: value })); }} onBlur={() => { const value = Math.max(10, Math.min(22, Math.round(Number(fontInput) || 12))); setFontInput(String(value)); setDraft(d => ({ ...d, codeFontSize: value })); }} /><span>px</span></div></label></div><label className="settings-toggle"><span><strong>{t('自动换行')}</strong><small>{t('长代码行在视图宽度内换行，减少横向滚动。')}</small></span><input type="checkbox" role="switch" aria-label={t('代码自动换行')} checked={draft.wordWrap} disabled={!!busy} onChange={e => setDraft(d => ({ ...d, wordWrap: e.target.checked }))} /></label><div className="settings-code-preview" style={{ fontSize: draft.codeFontSize, whiteSpace: draft.wordWrap ? 'pre-wrap' : 'pre' }}><span>01</span> <em>const</em> view = <b>'your code, in perspective'</b>;<br /><span>02</span> <em>return</em> changes.map(commit =&gt; commit.story);</div><p className="settings-help">{t('字号与换行同时作用于完整代码、差异和冲突编辑区；默认差异视图在保存时与下次启动时生效。')}</p></section>
          </>}
        </div>
      </div>
      <footer className="settings-footer"><div className="settings-feedback">{error ? <span className="settings-save-error" role="alert">{error}</span> : notice ? <span className="settings-save-success"><Check size={13} />{notice}</span> : <span><Monitor size={13} />{t('偏好保存在此电脑的当前用户下')}</span>}</div><div><button type="button" className="text-button" disabled={!!busy} onClick={() => { setDraft({ ...DEFAULT_PREFERENCES }); setFontInput(String(DEFAULT_PREFERENCES.codeFontSize)); setGitTest(null); setNotice(t('默认值已填入，保存后生效。')); }}>{t('恢复默认')}</button><button type="button" className="secondary-button" disabled={!!busy} onClick={onClose}>{t('关闭')}</button><button type="button" className="primary-button" disabled={!!busy || !preferencesDirty} onClick={() => void savePreferences()}>{busy === 'preferences' ? <Loader2 className="spin" size={14} /> : <Check size={14} />}{t('保存应用设置')}</button></div></footer>
    </section>
  </div>;
}
