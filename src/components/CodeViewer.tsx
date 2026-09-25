import { memo, useMemo } from 'react';
import { Code2 } from 'lucide-react';
import { highlightCode } from '../lib/syntax';
import SyntaxTokens from './SyntaxTokens';
import { useI18n } from '../lib/i18n';
import './syntax.css';

function CodeViewer({ text, path }: { text: string | null; path?: string }) {
  const { t } = useI18n();
  const highlighted = useMemo(() => text === null ? null : highlightCode(text, path), [text, path]);
  if (!highlighted) return <div className="empty-state"><div className="empty-icon"><Code2 size={28} /></div><strong>{t('选择文件以浏览代码')}</strong><p>{t('查看当前选中提交的完整文件内容。')}</p></div>;
  return <div className="source-scroll" tabIndex={0} aria-label={t('完整代码')}><div className="source-code">{highlighted.lines.map((tokens, index) => <div className="source-line" key={index}><span className="line-number">{index + 1}</span><code>{tokens.length ? <SyntaxTokens tokens={tokens} /> : '\u200b'}</code></div>)}</div>{highlighted.limited && <div className="syntax-limit-note">{t('较长内容保留原文，部分语法颜色已简化。')}</div>}</div>;
}
export default memo(CodeViewer);
