import { useEffect, useState } from 'react';
import { Activity, HardDrive, Loader2, RefreshCw, Trash2 } from 'lucide-react';
import type { ResourceUsage } from '../../shared/types';
import { useI18n } from '../lib/i18n';
import './resource-settings.css';

const size = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
export default function ResourceSettings() {
  const { t } = useI18n();
  const [usage, setUsage] = useState<ResourceUsage>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let alive = true;
    window.gitvista.resourceUsage().then(value => { if (alive) setUsage(value); }).catch(error => { if (alive) setError(String(error)); });
    return () => { alive = false; };
  }, []);
  const refresh = async (clear: boolean) => {
    setBusy(true); setError('');
    try { setUsage(await (clear ? window.gitvista.clearRuntimeCache() : window.gitvista.resourceUsage())); }
    catch (error) { setError(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };
  return <section className="settings-section resource-settings">
    <h3><Activity size={15} />{t('存储与性能')}</h3>
    {usage ? <div className="resource-cards">
      <div><span>{t('应用内存')}</span><strong>{size(usage.privateBytes || usage.workingSetBytes)}</strong><small>{usage.processes} {t('个应用进程，不含 Git 子进程')}</small></div>
      <div><span>{t('可重建缓存')}</span><strong>{size(usage.cacheBytes)}</strong><small>{t('维护阈值')} {size(usage.cacheBudgetBytes)}</small></div>
    </div> : <p className="settings-help"><Loader2 className="spin" size={14} /> {t('读取占用中…')}</p>}
    <p className="settings-help">{t('隐藏到托盘时暂停自动刷新；历史和大文件按需加载。')}</p>
    <p className="settings-help">{t('清理缓存不会删除仓库、提交草稿或设置。GPU 缓存会在下次启动时安全清理。')}</p>
    {usage?.pendingCacheCleanup && <p className="resource-pending"><HardDrive size={13} />{t('已安排下次启动清理剩余缓存。')}</p>}
    <div className="resource-actions"><button type="button" className="secondary-button" disabled={busy} onClick={() => void refresh(false)}><RefreshCw size={13} />{t('刷新占用')}</button><button type="button" className="secondary-button" disabled={busy} onClick={() => void refresh(true)}>{busy ? <Loader2 className="spin" size={13} /> : <Trash2 size={13} />}{t('清理可重建缓存')}</button></div>
    {error && <div className="modal-error" role="alert">{error}</div>}
  </section>;
}
