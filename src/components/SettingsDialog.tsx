import { useEffect, useRef, useState } from 'react';
import { Check, ChevronRight, Code2, FolderOpen, GitBranch, Loader2, Monitor, Palette, Save, Settings2, ShieldCheck, Terminal, UserRound, X } from 'lucide-react';
import { DEFAULT_PREFERENCES } from '../../shared/types';
import type { AppPreferences, AppSettings, AppTheme, GitIdentity, IdentityFields } from '../../shared/types';

const THEMES: { value: AppTheme; name: string; detail: string; colors: string[] }[] = [
  { value: 'dark', name: '石墨深色', detail: '安静、专注', colors: ['#11151d', '#1e2431', '#b5a0ed', '#8ad6b0'] },
  { value: 'light', name: '云白浅色', detail: '明亮、清晰', colors: ['#edf0f6', '#ffffff', '#7954bd', '#24865a'] },
  { value: 'midnight', name: '午夜蓝', detail: '深邃、纯粹', colors: ['#0b1020', '#1b2640', '#86b9ff', '#79d6cf'] },
  { value: 'nord', name: '北欧极光', detail: '柔和、冷静', colors: ['#242c39', '#374355', '#91c3d0', '#a3c793'] },
  { value: 'forest', name: '森林绿', detail: '自然、舒展', colors: ['#111c1a', '#22342e', '#c5d49b', '#80c3a0'] },
  { value: 'rose', name: '暮光玫瑰', detail: '温润、细腻', colors: ['#21171f', '#362938', '#e4a9ca', '#accdaa'] },
];
const blankIdentity: GitIdentity = { local: { name: '', email: '' }, global: { name: '', email: '' }, effective: { name: '', email: '' } };
const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);
function preferencesOf(settings: AppSettings): AppPreferences {
  return { theme: settings.theme, gitPath: settings.gitPath, pullStrategy: settings.pullStrategy, diffView: settings.diffView, codeFontSize: settings.codeFontSize, wordWrap: settings.wordWrap };
}

export default function SettingsDialog({ settings, repo, onSaved, onClose }: { settings: AppSettings; repo: string; onSaved: (settings: AppSettings) => void; onClose: () => void }) {
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
  useEffect(() => { const listener = (event: KeyboardEvent) => { if (event.key === 'Tab') { const elements = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]') || []).filter(element => element.offsetParent !== null); const first = elements[0]; const last = elements[elements.length - 1]; if (first && last && ((event.shiftKey && document.activeElement === first) || (!event.shiftKey && document.activeElement === last) || !dialogRef.current?.contains(document.activeElement))) { event.preventDefault(); (event.shiftKey ? last : first).focus(); } } if (event.key === 'Escape') { event.stopImmediatePropagation(); if (!busy) onClose(); } }; window.addEventListener('keydown', listener, true); return () => window.removeEventListener('keydown', listener, true); }, [busy, onClose]);

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
      setIdentity(value); setIdentityDrafts(d => ({ ...d, [requestScope]: { ...value[requestScope] } })); setNotice(requestScope === 'local' ? '当前仓库的提交身份已保存。' : '全局提交身份已保存。');
    } catch (e) { if (mounted.current && id === identityRequest.current && currentRepo.current === requestRepo) setIdentityError(errorText(e)); }
    finally { if (mounted.current) setBusy(''); }
  };
  const identityDirty = !!identity && (identityDrafts[scope].name !== identity[scope].name || identityDrafts[scope].email !== identity[scope].email);
  const preferencesDirty = JSON.stringify(draft) !== JSON.stringify(preferencesOf(settings));
  const initialGitPath = settings.gitPath || 'git';

  return <div className="modal-backdrop settings-backdrop" onMouseDown={e => { if (e.target === e.currentTarget && !busy) onClose(); }}>
    <section ref={dialogRef} className="settings-dialog" role="dialog" aria-modal="true" aria-label="应用设置">
      <header className="settings-header"><div><span className="settings-brand"><Settings2 size={20} /></span><span><strong>应用设置</strong><small>打造顺手的 Git 工作环境</small></span></div><button type="button" className="icon-button" title="关闭设置" aria-label="关闭设置" onClick={onClose} disabled={!!busy}><X size={19} /></button></header>
      <div className="settings-body"><nav className="settings-nav" aria-label="设置分类"><span>偏好设置</span><button autoFocus className={tab === 'git' ? 'active' : ''} onClick={() => setTab('git')}><GitBranch size={16} /><span>Git 与提交</span><ChevronRight size={12} /></button><button className={tab === 'appearance' ? 'active' : ''} onClick={() => setTab('appearance')}><Palette size={16} /><span>外观与差异</span><ChevronRight size={12} /></button><div className="settings-nav-bottom"><kbd>Ctrl</kbd><kbd>Alt</kbd><kbd>S</kbd><p>随时打开设置</p></div></nav>
        <div className="settings-content">
          {tab === 'git' ? <>
            <div className="settings-page-title"><h2>Git 与提交</h2><p>连接本机 Git，设置提交身份与默认拉取方式。</p></div>
            <section className="settings-section"><h3><Terminal size={15} />Git 可执行文件</h3><label className="form-field"><span>Git 路径</span><div className="settings-path"><input aria-label="Git 路径" spellCheck={false} placeholder="git 或 C:\Program Files\Git\cmd\git.exe" value={draft.gitPath} onChange={e => changeGitPath(e.target.value)} disabled={!!busy} /><button className="secondary-button" type="button" disabled={!!busy} onClick={() => void browseGitPath()} title="浏览 Git 可执行文件"><FolderOpen size={14} />浏览</button><button className="secondary-button" type="button" disabled={!!busy} onClick={() => void testGitPath()}>{busy === 'test' ? <Loader2 className="spin" size={14} /> : <Terminal size={14} />}测试</button></div></label><p className="settings-help">填写 git 使用系统 PATH，或选择 git.exe 的完整路径。保存后用于后续 Git 操作。</p>{gitTest && <div className={`settings-test ${gitTest.error ? 'failed' : 'success'}`}>{gitTest.error ? <X size={14} /> : <Check size={14} />}<span>{gitTest.error || gitTest.version}</span></div>}</section>
            <section className="settings-section identity-section"><h3><UserRound size={15} />提交身份</h3>{!repo ? <div className="settings-empty"><FolderOpen size={20} /><span>打开一个仓库后，可查看与设置提交身份。</span></div> : <><div className="settings-current-repo" title={repo}><FolderOpen size={12} /><span>{repo}</span></div><div className="identity-effective"><span>当前有效身份</span>{identityLoading ? <span><Loader2 className="spin" size={12} />读取中…</span> : identity ? <strong>{identity.effective.name || '未设置姓名'} <small>〈{identity.effective.email || '未设置邮箱'}〉</small></strong> : <span>尚未读取成功</span>}</div><div className="identity-scope" role="group" aria-label="身份配置范围"><button className={scope === 'local' ? 'active' : ''} disabled={!!busy || identityLoading} onClick={() => setScope('local')}>当前仓库 <span>Local</span></button><button className={scope === 'global' ? 'active' : ''} disabled={!!busy || identityLoading} onClick={() => setScope('global')}>全局配置 <span>Global</span></button></div><p className="identity-scope-hint">{scope === 'local' ? '只影响当前仓库；字段留空会移除本地配置，继承全局或其他上级配置。' : '影响本机使用此全局配置的仓库；仓库本地设置优先。字段留空会移除对应全局配置。'}</p><div className="identity-fields"><label className="form-field"><span>提交者姓名</span><input aria-label="提交者姓名" placeholder={scope === 'local' ? identity?.global.name || '继承上级配置' : '姓名'} value={identityDrafts[scope].name} disabled={!!busy || !identity || identityLoading} onChange={e => setIdentityDrafts(d => ({ ...d, [scope]: { ...d[scope], name: e.target.value } }))} /></label><label className="form-field"><span>提交者邮箱</span><input aria-label="提交者邮箱" spellCheck={false} placeholder={scope === 'local' ? identity?.global.email || '继承上级配置' : '邮箱'} value={identityDrafts[scope].email} disabled={!!busy || !identity || identityLoading} onChange={e => setIdentityDrafts(d => ({ ...d, [scope]: { ...d[scope], email: e.target.value } }))} /></label></div><div className="identity-save-row"><span><ShieldCheck size={12} />独立保存，不随应用设置一起修改</span><button className="secondary-button" type="button" disabled={!!busy || !identity || !identityDirty} onClick={() => void saveIdentity()}>{busy === 'identity' ? <Loader2 className="spin" size={14} /> : <Save size={14} />}保存{scope === 'local' ? '仓库' : '全局'}身份</button></div>{initialGitPath !== draft.gitPath && <p className="settings-help">身份信息使用当前已保存的 Git 路径读取；如要更换 Git，请先保存应用设置。</p>}</>}{identityError && <div className="modal-error">{identityError}</div>}</section>
            <section className="settings-section"><h3><GitBranch size={15} />默认拉取策略</h3><label className="form-field"><span>工具栏“拉取”使用</span><select aria-label="默认拉取策略" value={draft.pullStrategy} disabled={!!busy} onChange={e => setDraft(d => ({ ...d, pullStrategy: e.target.value as AppPreferences['pullStrategy'] }))}><option value="ff-only">仅快进（ff-only）</option><option value="merge">合并（merge）</option><option value="rebase">变基（rebase）</option></select></label><p className="settings-help">{draft.pullStrategy === 'ff-only' ? '仅在能够快进时更新；本地与远端分叉时停止，保留你的处理选择。' : draft.pullStrategy === 'merge' ? '拉取后合并远端提交；存在分叉时可能生成合并提交。' : '将本地提交重放到远端新提交之后；会改写这些本地提交的哈希。'}</p></section>
          </> : <>
            <div className="settings-page-title"><h2>外观与差异</h2><p>用熟悉的色彩与阅读方式，专注每一行变化。</p></div>
            <section className="settings-section"><h3><Palette size={15} />界面主题</h3><div className="theme-grid" role="group" aria-label="界面主题">{THEMES.map(theme => <button className={`theme-card ${draft.theme === theme.value ? 'selected' : ''}`} key={theme.value} disabled={!!busy} aria-pressed={draft.theme === theme.value} onClick={() => setDraft(d => ({ ...d, theme: theme.value }))}><div className="theme-preview" style={{ background: theme.colors[0] }}><div style={{ background: theme.colors[1] }} /><span style={{ background: theme.colors[2] }} /><span style={{ background: theme.colors[3] }} /><i style={{ background: theme.colors[2] }} />{draft.theme === theme.value && <b style={{ background: theme.colors[2], color: theme.colors[0] }}><Check size={11} /></b>}</div><span>{theme.name}</span><small>{theme.detail}</small></button>)}</div></section>
            <section className="settings-section"><h3><Code2 size={15} />代码阅读</h3><div className="settings-two-columns"><label className="form-field"><span>默认差异视图</span><select aria-label="默认差异视图" value={draft.diffView} disabled={!!busy} onChange={e => setDraft(d => ({ ...d, diffView: e.target.value as AppPreferences['diffView'] }))}><option value="split">并排比较</option><option value="unified">统一比较</option></select></label><label className="form-field"><span>代码字号</span><div className="settings-number"><input aria-label="代码字号" type="number" min="10" max="22" step="1" value={fontInput} disabled={!!busy} onChange={e => { setFontInput(e.target.value); const value = Number(e.target.value); if (Number.isInteger(value) && value >= 10 && value <= 22) setDraft(d => ({ ...d, codeFontSize: value })); }} onBlur={() => { const value = Math.max(10, Math.min(22, Math.round(Number(fontInput) || 12))); setFontInput(String(value)); setDraft(d => ({ ...d, codeFontSize: value })); }} /><span>px</span></div></label></div><label className="settings-toggle"><span><strong>自动换行</strong><small>长代码行在视图宽度内换行，减少横向滚动。</small></span><input type="checkbox" role="switch" aria-label="代码自动换行" checked={draft.wordWrap} disabled={!!busy} onChange={e => setDraft(d => ({ ...d, wordWrap: e.target.checked }))} /></label><div className="settings-code-preview" style={{ fontSize: draft.codeFontSize, whiteSpace: draft.wordWrap ? 'pre-wrap' : 'pre' }}><span>01</span> <em>const</em> view = <b>'your code, in perspective'</b>;<br /><span>02</span> <em>return</em> changes.map(commit =&gt; commit.story);</div><p className="settings-help">字号与换行同时作用于完整代码、差异和冲突编辑区；默认差异视图在保存时与下次启动时生效。</p></section>
          </>}
        </div>
      </div>
      <footer className="settings-footer"><div className="settings-feedback">{error ? <span className="settings-save-error" role="alert">{error}</span> : notice ? <span className="settings-save-success"><Check size={13} />{notice}</span> : <span><Monitor size={13} />偏好保存在此电脑的当前用户下</span>}</div><div><button type="button" className="text-button" disabled={!!busy} onClick={() => { setDraft({ ...DEFAULT_PREFERENCES }); setFontInput(String(DEFAULT_PREFERENCES.codeFontSize)); setGitTest(null); setNotice('默认值已填入，保存后生效。'); }}>恢复默认</button><button type="button" className="secondary-button" disabled={!!busy} onClick={onClose}>关闭</button><button type="button" className="primary-button" disabled={!!busy || !preferencesDirty} onClick={() => void savePreferences()}>{busy === 'preferences' ? <Loader2 className="spin" size={14} /> : <Check size={14} />}保存应用设置</button></div></footer>
    </section>
  </div>;
}
