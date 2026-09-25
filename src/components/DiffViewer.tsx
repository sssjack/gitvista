import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { CheckCheck, FileDiff, Files } from 'lucide-react';
import type { DiffResult } from '../../shared/types';
import { parseDiffLines, type DiffLine } from '../lib/diff-lines';
import { presentDiff } from '../lib/diff-presentation';
import { clamp, usePanelSize } from '../lib/panel-preferences';
import { highlightDiffLines } from '../lib/syntax-diff';
import ResizeHandle from './ResizeHandle';
import SyntaxTokens from './SyntaxTokens';
import './diff-viewer.css';
import { useI18n } from '../lib/i18n';

function DiffViewer({ diff, split, wordWrap = false, fontSize = 12, path }: { diff: DiffResult | null; split: boolean; wordWrap?: boolean; fontSize?: number; path?: string }) {
  const { t } = useI18n();
  const summaryText = (text: string) => { const colon = text.indexOf('：'); return colon < 0 ? t(text) : `${t(text.slice(0, colon))}: ${text.slice(colon + 1)}`; };
  const lines = useMemo(() => diff?.text ? parseDiffLines(diff.text) : [], [diff?.text]);
  const files = useMemo(() => presentDiff(lines, path), [lines, path]);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const file = files.find(item => item.key === selectedFile) || files[0];
  const pairs = file?.pairs;
  const syntax = useMemo(() => highlightDiffLines(lines, path), [lines, path]);
  const [ratio, setRatio] = usePanelSize('diffRatio', .5, .2, .8);
  const root = useRef<HTMLDivElement>(null); const left = useRef<HTMLDivElement>(null); const right = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!split || !left.current || !right.current) return;
    if (!wordWrap) { [left.current, right.current].forEach(side => side?.querySelectorAll<HTMLElement>('[data-diff-row]').forEach(row => { row.style.height = ''; })); return; }
    let frame = 0;
    const align = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const a = left.current?.querySelectorAll<HTMLElement>('[data-diff-row]');
        const b = right.current?.querySelectorAll<HTMLElement>('[data-diff-row]');
        if (!a || !b) return;
        a.forEach((row, i) => { row.style.height = ''; if (b[i]) b[i].style.height = ''; });
        const heights = [...a].map((row, i) => Math.max(row.getBoundingClientRect().height, b[i]?.getBoundingClientRect().height || 0));
        a.forEach((row, i) => { row.style.height = `${heights[i]}px`; if (b[i]) b[i].style.height = `${heights[i]}px`; });
      });
    };
    align(); const observer = new ResizeObserver(align); if (root.current) observer.observe(root.current);
    return () => { cancelAnimationFrame(frame); observer.disconnect(); };
  }, [pairs, split, wordWrap, fontSize, wordWrap ? ratio : 0]);
  useEffect(() => { setSelectedFile(null); }, [diff?.text]);
  useEffect(() => { if (left.current) { left.current.scrollTop = 0; left.current.scrollLeft = 0; } if (right.current) { right.current.scrollTop = 0; right.current.scrollLeft = 0; } }, [diff?.text, file?.key]);
  const empty = !diff ? [t('选择文件以查看差异'), <FileDiff size={30} />] : !diff.text.trim() ? [t(diff.binary ? '二进制内容发生变化' : '没有文本差异'), diff.binary ? <Files size={30} /> : <CheckCheck size={30} />] : null;
  if (empty) return <div className="empty-state"><div className="empty-icon">{empty[1]}</div><strong>{empty[0]}</strong></div>;
  const warning = diff?.truncated && <div className="inline-warning">{t("差异内容较大，已截断显示。请使用外部编辑器检查完整文件。")}</div>;
  const code = (row?: DiffLine, side: 'left' | 'right' = 'right') => {
    if (!row) return '\u200b';
    const tokens = syntax.tokens.get(row)?.[side];
    return tokens?.length ? <SyntaxTokens tokens={tokens} /> : row.text.slice(1) || '\u200b';
  };
  const side = (name: 'left' | 'right') => <section className="diff-side" aria-label={name === 'left' ? t('原始版本') : t('修改后')}>
    <div className="diff-side-heading">{name === 'left' ? t('原始版本') : t('修改后')}</div>
    <div className="diff-side-scroll" ref={name === 'left' ? left : right} tabIndex={0} onScroll={event => {
      const target = name === 'left' ? right.current : left.current;
      if (target && Math.abs(target.scrollTop - event.currentTarget.scrollTop) > 1) target.scrollTop = event.currentTarget.scrollTop;
    }}><div className="diff-code">{pairs?.map((pair, index) => {
      if (pair.kind === 'gap') return <div className="diff-gap" role="separator" aria-label={t("中间未变化的代码已省略")} title={t("中间未变化的代码已省略")} data-diff-row={index} key={index}><span>···</span></div>;
      const row = pair[name];
      return <div className={`diff-side-line ${row ? pair.kind : 'empty'}`} data-change={row ? pair.kind : undefined} data-diff-row={index} key={index}>
        <span className="line-number">{name === 'left' ? row?.old : row?.next}</span><code>{code(row, name)}</code>
      </div>;
    })}</div></div>
  </section>;
  return <div className={`diff-viewer ${wordWrap ? 'wrap-lines' : ''}`} ref={root}>
    {files.length > 1 && <div className="diff-file-tabs" role="tablist" aria-label={t("差异文件")}>{files.map(item => <button role="tab" aria-selected={item.key === file?.key} className={item.key === file?.key ? 'active' : ''} key={item.key} title={item.path} onClick={() => setSelectedFile(item.key)}><FileDiff size={12} />{item.path}</button>)}</div>}
    {!!pairs?.length && <div className="diff-change-legend" aria-label={t("差异颜色说明")}><span className="add"><i />{t('新增')} {file.counts.add}</span><span className="modify"><i />{t('修改')} {file.counts.modify}</span><span className="remove"><i />{t('删除')} {file.counts.remove}</span>{file.summary.length > 0 && <span className="diff-file-summary" title={file.summary.map(summaryText).join('; ')}>{file.summary.map(summaryText).join('; ')}</span>}</div>}
    {!pairs?.length ? <div className="empty-state diff-information"><div className="empty-icon"><Files size={30} /></div><strong>{file?.binary || files.length === 1 && diff?.binary ? t('二进制内容发生变化') : t('仅文件信息发生变化')}</strong>{(file?.summary || [t('未包含可显示的文本差异。')]).map((text, index) => <p key={index}>{summaryText(text)}</p>)}</div> : split ? <div className="diff-split-layout" style={{ gridTemplateColumns: `minmax(0,${ratio}fr) 6px minmax(0,${1 - ratio}fr)` }}>
      {side('left')}<ResizeHandle direction="vertical" label={t("调整左右差异宽度")} onResize={delta => setRatio(current => clamp(current + delta / Math.max(1, root.current?.clientWidth || 1), .2, .8))} onReset={() => setRatio(.5)} />{side('right')}
    </div> : <div className="diff-scroll unified" tabIndex={0}><div className="diff-code">{file.unified.map((row, index) => row.kind === 'gap' ? <div className="diff-gap" role="separator" aria-label={t("中间未变化的代码已省略")} title={t("中间未变化的代码已省略")} key={index}><span>···</span></div> : <div className={`diff-line ${row.kind}`} data-change={row.kind} key={index}><span className="line-number">{row.line.old}</span><span className="line-number">{row.line.next}</span><code>{code(row.line, row.line.kind === 'remove' ? 'left' : 'right')}</code></div>)}</div></div>}
    {warning}
    {syntax.limited && <div className="syntax-limit-note">{t("较长差异保留原文，部分语法颜色已简化。")}</div>}
  </div>;
}
export default memo(DiffViewer);
