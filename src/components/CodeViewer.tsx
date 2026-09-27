import { memo, useEffect, useMemo, useState } from 'react';
import { Code2 } from 'lucide-react';
import { highlightCode } from '../lib/syntax';
import SyntaxTokens from './SyntaxTokens';
import { useI18n } from '../lib/i18n';
import './syntax.css';
import { indexTextPages, readTextPage } from '../lib/text-pages';
import ResourcePager from './ResourcePager';

function CodeViewer({ text, path }: { text: string | null; path?: string }) {
  const { t } = useI18n();
  const [pageNumber, setPageNumber] = useState(0);
  const pages = useMemo(() => text === null ? [] : indexTextPages(text), [text]);
  const pageIndex = Math.min(pageNumber, Math.max(0, pages.length - 1));
  const page = pages[pageIndex];
  const highlighted = useMemo(() => text === null || !page ? null : highlightCode(readTextPage(text, page), path), [text, page, path]);
  useEffect(() => setPageNumber(0), [text, path]);
  if (!highlighted) return <div className="empty-state"><div className="empty-icon"><Code2 size={28} /></div><strong>{t('选择文件以浏览代码')}</strong><p>{t('查看当前选中提交的完整文件内容。')}</p></div>;
  return <div className="resource-text-viewer"><ResourcePager page={pageIndex} pages={pages.length} onPage={setPageNumber} label={`${t('代码行')} ${page.firstLine}–${page.firstLine + page.lines - 1}`} /><div key={pageIndex} className="source-scroll" tabIndex={0} aria-label={t('完整代码')}><div className="source-code">{highlighted.lines.map((tokens, index) => <div className="source-line" key={index}><span className="line-number">{page.firstLine + index}</span><code>{tokens.length ? <SyntaxTokens tokens={tokens} /> : '\u200b'}</code></div>)}</div>{(highlighted.limited || pages.length > 1) && <div className="syntax-limit-note">{t('较长内容保留原文，部分语法颜色已简化。')}</div>}</div></div>;
}
export default memo(CodeViewer);
