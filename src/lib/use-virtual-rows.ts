import { useCallback, useLayoutEffect, useState, type RefObject } from 'react';
import { RESOURCE_BUDGET } from './resource-budget';

export function useVirtualRows(ref: RefObject<HTMLDivElement | null>, count: number, rowHeight: number) {
  const [viewport, setViewport] = useState({ top: 0, height: 600 });
  const measure = useCallback(() => {
    const element = ref.current;
    if (element) setViewport(current => current.top === element.scrollTop && current.height === element.clientHeight ? current : { top: element.scrollTop, height: element.clientHeight });
  }, [ref]);
  useLayoutEffect(() => {
    const element = ref.current; if (!element) return;
    const observer = new ResizeObserver(measure); observer.observe(element); measure();
    element.addEventListener('scroll', measure, { passive: true });
    return () => { observer.disconnect(); element.removeEventListener('scroll', measure); };
  }, [measure, count]);
  const start = Math.max(0, Math.min(count, Math.floor(viewport.top / rowHeight) - RESOURCE_BUDGET.overscan));
  const end = Math.min(count, Math.max(start, Math.ceil((viewport.top + viewport.height) / rowHeight) + RESOURCE_BUDGET.overscan));
  return { start, end, before: start * rowHeight, after: (count - end) * rowHeight };
}
