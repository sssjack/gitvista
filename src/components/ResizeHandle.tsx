import { useEffect, useRef, useState } from 'react';

export default function ResizeHandle({ direction, onResize, onReset, label = '调整面板大小', title, value, min, max }: {
  direction: 'vertical' | 'horizontal'; onResize: (delta: number) => void; onReset?: () => void; label?: string;
  title?: string; value?: number; min?: number; max?: number;
}) {
  const [dragging, setDragging] = useState(false);
  const last = useRef<number | null>(null);
  const cleanup = useRef<(() => void) | undefined>(undefined);
  const finish = () => { last.current = null; setDragging(false); cleanup.current?.(); cleanup.current = undefined; };
  useEffect(() => () => cleanup.current?.(), []);
  return <div className={`resize-handle ${direction} ${dragging ? 'dragging' : ''}`} role="separator" tabIndex={0}
    aria-label={label} aria-orientation={direction} aria-valuenow={value} aria-valuemin={min} aria-valuemax={max} title={title ?? `${label} · 拖动或方向键调整，双击恢复默认`}
    onDoubleClick={onReset} onKeyDown={event => {
      const negative = direction === 'vertical' ? 'ArrowLeft' : 'ArrowUp';
      const positive = direction === 'vertical' ? 'ArrowRight' : 'ArrowDown';
      if (event.key === negative || event.key === positive) { event.preventDefault(); onResize((event.key === negative ? -1 : 1) * (event.shiftKey ? 40 : 10)); }
      if (event.key === 'Home' && onReset) { event.preventDefault(); onReset(); }
    }} onPointerDown={event => {
      if (event.button !== 0) return;
      event.preventDefault(); event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId);
      last.current = direction === 'vertical' ? event.clientX : event.clientY; setDragging(true);
      const { cursor, userSelect } = document.body.style;
      document.body.style.cursor = direction === 'vertical' ? 'col-resize' : 'row-resize'; document.body.style.userSelect = 'none';
      cleanup.current = () => { document.body.style.cursor = cursor; document.body.style.userSelect = userSelect; };
    }} onPointerMove={event => {
      if (last.current === null) return;
      const position = direction === 'vertical' ? event.clientX : event.clientY;
      const delta = position - last.current; last.current = position;
      if (delta) onResize(delta);
    }} onPointerUp={event => { finish(); if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}
    onPointerCancel={finish} onLostPointerCapture={finish} />;
}
