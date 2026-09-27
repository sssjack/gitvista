import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useI18n } from '../lib/i18n';
import './resource-pager.css';

export default function ResourcePager({ page, pages, onPage, label }: { page: number; pages: number; onPage: (page: number) => void; label?: string }) {
  const { t } = useI18n();
  if (pages <= 1) return null;
  return <nav className="resource-pager" aria-label={t('内容分页')}>
    <span title={t('只保留当前页的显示数据，可随时翻页查看完整内容。')}>{label || t('大文件分页模式')}</span>
    <button type="button" aria-label={t('上一页')} disabled={page === 0} onClick={() => onPage(page - 1)}><ChevronLeft size={14} /></button>
    <label><input type="number" min={1} max={pages} aria-label={t('页码')} value={page + 1} onChange={event => { const value = Number(event.target.value); if (Number.isInteger(value) && value >= 1 && value <= pages) onPage(value - 1); }} /><span>/ {pages}</span></label>
    <button type="button" aria-label={t('下一页')} disabled={page + 1 >= pages} onClick={() => onPage(page + 1)}><ChevronRight size={14} /></button>
  </nav>;
}
