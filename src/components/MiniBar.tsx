import { ArrowDown, GripVertical, Maximize2, RefreshCw } from 'lucide-react';
import type { DesktopCommand, DesktopState } from '../../shared/types';
import { useI18n } from '../lib/i18n';
import './mini-bar.css';

export default function MiniBar({ state }: { state: DesktopState }) {
  const { t } = useI18n();
  const command = (action: DesktopCommand) => { void window.gitvistaMini.desktopCommand(action); };
  const commit = state.commits[0];
  return <section className={`mini-bar direction-${state.direction} edge-${state.edge || 'none'} ${state.expanded ? 'is-expanded' : ''} ${state.collapsed ? 'is-collapsed' : ''}`} aria-label={t('迷你横条')}>
    <div className="mini-content" aria-hidden={!state.expanded || state.collapsed} title={state.error || (commit ? `${commit.hash}\n${commit.subject}\n${commit.author} · ${commit.date}` : t('没有记录'))}>
      <div className="mini-meta"><span className="mini-live" /><strong>{state.repo.split(/[\\/]/).pop() || 'GitVista'}</strong><span>{commit?.short || t('最新提交')}</span></div>
      <div className={`mini-subject ${state.error ? 'mini-error' : ''}`}>{state.error || commit?.subject || t(state.repo ? '还没有提交' : '请先打开仓库')}</div>
    </div>
    <div className="mini-controls" inert={state.collapsed}>
      <div className={`mini-grip ${state.error ? 'mini-error' : ''}`} title={state.error || t('拖动到屏幕边缘可自动收起')}><GripVertical size={13} /></div>
      <div className="mini-actions">
      <button aria-label={t('拉取更新')} title={t('拉取更新')} disabled={!state.repo || state.busy} onClick={() => command('pull')}><ArrowDown size={16} /></button>
      <button aria-label={t('刷新')} title={t('刷新')} disabled={!state.repo || state.busy} onClick={() => command('refresh')}><RefreshCw size={15} className={state.busy ? 'spin' : ''} /></button>
      <button aria-label={t('打开主窗口')} title={t('打开主窗口')} onClick={() => command('restore')}><Maximize2 size={14} /></button>
      </div>
    </div>
    {state.collapsed && <button className="mini-edge" aria-label={t('展开迷你横条')} onClick={() => command('expand')}><span /></button>}
  </section>;
}
