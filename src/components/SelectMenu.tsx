import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent, ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, Search, X } from 'lucide-react';
import './select-menu.css';
import { useI18n } from '../lib/i18n';

export type SelectMenuOption = { value: string; label: string; description?: string; icon?: ReactNode; disabled?: boolean; group?: string };
export type SelectMenuProps = {
  value: string; onChange: (value: string) => void; label: string; options: SelectMenuOption[];
  placeholder?: string; searchable?: boolean; searchPlaceholder?: string; className?: string;
  disabled?: boolean; align?: 'start' | 'end';
};
type OptionGroup = { label: string; options: SelectMenuOption[] };
type PopupPosition = { left: number; top: number; width: number; maxHeight: number; side: 'top' | 'bottom' };

function optionGroups(options: SelectMenuOption[], query: string): OptionGroup[] {
  const groups: OptionGroup[] = [];
  const byName = new Map<string, OptionGroup>();
  const needle = query.trim().toLocaleLowerCase();
  for (const option of options) {
    if (needle && !`${option.label}\n${option.description || ''}\n${option.group || ''}`.toLocaleLowerCase().includes(needle)) continue;
    const name = option.group || '';
    let group = byName.get(name);
    if (!group) { group = { label: name, options: [] }; byName.set(name, group); groups.push(group); }
    group.options.push(option);
  }
  return groups;
}

function navigateOption(options: SelectMenuOption[], current: string | null, key: 'ArrowDown' | 'ArrowUp' | 'Home' | 'End'): string | null {
  const enabled = options.filter(option => !option.disabled);
  if (!enabled.length) return null;
  if (key === 'Home') return enabled[0].value;
  if (key === 'End') return enabled[enabled.length - 1].value;
  const index = enabled.findIndex(option => option.value === current);
  if (index < 0) return key === 'ArrowUp' ? enabled[enabled.length - 1].value : enabled[0].value;
  return enabled[(index + (key === 'ArrowDown' ? 1 : -1) + enabled.length) % enabled.length].value;
}

function popupPosition(rect: Pick<DOMRect, 'left' | 'right' | 'top' | 'bottom' | 'width'>, viewport: { width: number; height: number }, desiredHeight: number, actualHeight: number, searchable: boolean, align: 'start' | 'end'): PopupPosition {
  const margin = 8; const gap = 6;
  const width = Math.min(Math.max(rect.width, searchable ? 290 : 230), Math.max(0, viewport.width - margin * 2));
  const below = Math.max(0, viewport.height - rect.bottom - gap - margin);
  const above = Math.max(0, rect.top - gap - margin);
  const side = below >= Math.min(desiredHeight, 260) || below >= above ? 'bottom' : 'top';
  const maxHeight = Math.min(380, side === 'bottom' ? below : above);
  const height = Math.min(actualHeight || desiredHeight, maxHeight);
  const left = Math.max(margin, Math.min(align === 'end' ? rect.right - width : rect.left, viewport.width - margin - width));
  const top = Math.max(margin, Math.min(side === 'bottom' ? rect.bottom + gap : rect.top - gap - height, viewport.height - margin - height));
  return { left, top, width, maxHeight, side };
}

export function SelectMenu({ value, onChange, label, options, placeholder = '请选择', searchable = false, searchPlaceholder = '搜索选项…', className = '', disabled = false, align = 'start' }: SelectMenuProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState<string | null>(null);
  const [position, setPosition] = useState<PopupPosition | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const optionRefs = useRef(new Map<string, HTMLDivElement>());
  const focusFrame = useRef<number | null>(null);
  const typeahead = useRef({ text: '', at: 0 });
  const listId = `select-menu-${useId()}`;
  const groups = useMemo(() => optionGroups(options, query), [options, query]);
  const visible = useMemo(() => groups.flatMap(group => group.options), [groups]);
  const optionIds = useMemo(() => new Map(visible.map((option, index) => [option.value, `${listId}-option-${index}`])), [visible, listId]);
  const selected = options.find(option => option.value === value);

  const close = useCallback((restoreFocus = true) => {
    setOpen(false); setQuery(''); setPosition(null);
    if (focusFrame.current !== null) cancelAnimationFrame(focusFrame.current);
    if (restoreFocus) focusFrame.current = requestAnimationFrame(() => { focusFrame.current = null; triggerRef.current?.focus({ preventScroll: true }); });
  }, []);
  const show = (edge?: 'Home' | 'End') => {
    if (disabled) return;
    if (focusFrame.current !== null) { cancelAnimationFrame(focusFrame.current); focusFrame.current = null; }
    const ordered = optionGroups(options, '').flatMap(group => group.options);
    setQuery(''); setPosition(null);
    setActive(edge ? navigateOption(ordered, null, edge) : selected && !selected.disabled ? selected.value : navigateOption(ordered, null, 'Home'));
    setOpen(true);
  };
  const choose = (option: SelectMenuOption) => {
    if (disabled || option.disabled) return;
    close();
    if (option.value !== value) onChange(option.value);
  };
  const focusAdjacent = (backwards: boolean) => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const modal = trigger.closest('[role="dialog"]');
    const scope = modal || document;
    const targets = [...scope.querySelectorAll<HTMLElement>('a[href],button,input,select,textarea,[tabindex]')].filter(element =>
      element.tabIndex >= 0 && !element.matches(':disabled') && !element.closest('[hidden],[inert],[aria-hidden="true"]') && !!element.getClientRects().length && !popupRef.current?.contains(element));
    const index = targets.indexOf(trigger);
    const nextIndex = index + (backwards ? -1 : 1);
    const next = targets[modal ? (nextIndex + targets.length) % targets.length : nextIndex];
    close(false);
    (next || trigger).focus({ preventScroll: true });
  };
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (disabled || event.nativeEvent.isComposing) return;
    const inSearch = event.target === searchRef.current;
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault(); event.stopPropagation();
      const key = event.key as 'ArrowDown' | 'ArrowUp' | 'Home' | 'End';
      if (!open) show(key === 'Home' || key === 'End' ? key : undefined);
      else setActive(current => navigateOption(visible, current, key));
      return;
    }
    if (event.key === 'Escape' && open) { event.preventDefault(); event.stopPropagation(); close(); return; }
    if (event.key === 'Tab' && open) { event.preventDefault(); event.stopPropagation(); focusAdjacent(event.shiftKey); return; }
    if (event.key === 'Enter' || (event.key === ' ' && !inSearch)) {
      event.preventDefault(); event.stopPropagation();
      if (!open) show();
      else { const option = visible.find(candidate => candidate.value === active); if (option) choose(option); }
      return;
    }
    if (!inSearch && event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault(); event.stopPropagation();
      if (!open) show();
      if (searchable) { setQuery(event.key); return; }
      const now = Date.now();
      const previous = now - typeahead.current.at < 700 ? typeahead.current.text : '';
      const text = previous && [...previous].every(character => character === event.key.toLocaleLowerCase()) ? event.key.toLocaleLowerCase() : previous + event.key.toLocaleLowerCase();
      typeahead.current = { text, at: now };
      const ordered = optionGroups(options, '').flatMap(group => group.options).filter(option => !option.disabled);
      const start = ordered.findIndex(option => option.value === active);
      const rotated = [...ordered.slice(start + 1), ...ordered.slice(0, start + 1)];
      const match = rotated.find(option => option.label.toLocaleLowerCase().startsWith(text));
      if (match) setActive(match.value);
    }
  };

  useEffect(() => { if (disabled && open) close(false); }, [disabled, open, close]);
  useEffect(() => {
    if (!open) return;
    setActive(current => visible.some(option => option.value === current && !option.disabled) ? current : visible.find(option => option.value === value && !option.disabled)?.value ?? navigateOption(visible, null, 'Home'));
  }, [open, visible, value]);
  useLayoutEffect(() => {
    if (!open) return;
    let frame: number | null = null;
    const measure = () => {
      frame = null;
      const trigger = triggerRef.current; const popup = popupRef.current;
      if (!trigger || !popup) return;
      const desired = Math.min(380, 12 + (searchable ? 46 : 0) + (visible.length ? visible.reduce((height, option) => height + (option.description ? 52 : 34), 0) : 70) + groups.filter(group => group.label).length * 25);
      const next = popupPosition(trigger.getBoundingClientRect(), { width: window.innerWidth, height: window.innerHeight }, desired, popup.getBoundingClientRect().height, searchable, align);
      setPosition(current => current && Object.keys(next).every(key => current[key as keyof PopupPosition] === next[key as keyof PopupPosition]) ? current : next);
    };
    const schedule = (event?: Event) => {
      if (event?.type === 'scroll' && event.target instanceof Node && popupRef.current?.contains(event.target)) return;
      if (frame === null) frame = requestAnimationFrame(measure);
    };
    measure();
    const observer = new ResizeObserver(() => schedule());
    if (triggerRef.current) observer.observe(triggerRef.current);
    if (popupRef.current) observer.observe(popupRef.current);
    window.addEventListener('resize', schedule); window.addEventListener('scroll', schedule, true);
    return () => { if (frame !== null) cancelAnimationFrame(frame); observer.disconnect(); window.removeEventListener('resize', schedule); window.removeEventListener('scroll', schedule, true); };
  }, [open, visible, groups, searchable, align]);
  useLayoutEffect(() => { if (open && searchable) searchRef.current?.focus({ preventScroll: true }); }, [open, searchable]);
  useEffect(() => { if (open && active !== null) optionRefs.current.get(active)?.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }, [open, active, position?.side]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: Event) => {
      const target = event.target;
      if (target instanceof Node && !triggerRef.current?.contains(target) && !popupRef.current?.contains(target)) close(false);
    };
    const blur = () => close(false);
    document.addEventListener('pointerdown', outside, true); document.addEventListener('focusin', outside, true); window.addEventListener('blur', blur);
    return () => { document.removeEventListener('pointerdown', outside, true); document.removeEventListener('focusin', outside, true); window.removeEventListener('blur', blur); };
  }, [open, close]);
  useEffect(() => () => { if (focusFrame.current !== null) cancelAnimationFrame(focusFrame.current); }, []);

  return <div className={`select-menu ${className}`}>
    <button ref={triggerRef} type="button" className={`select-menu-trigger ${!selected && !value ? 'is-placeholder' : ''}`} role="combobox" aria-label={label} aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? listId : undefined} aria-activedescendant={open && !searchable && active !== null ? optionIds.get(active) : undefined} disabled={disabled} title={selected ? `${selected.label}${selected.description ? `\n${selected.description}` : ''}` : label} onClick={() => open ? close() : show()} onKeyDown={onKeyDown}>
      <span className="select-menu-trigger-text">{selected?.label || value || placeholder}</span><ChevronDown className="select-menu-chevron" size={13} aria-hidden="true" />
    </button>
    {open && createPortal(<div ref={popupRef} className={`select-menu-popup ${position?.side === 'top' ? 'opens-up' : ''}`} style={{ ...(position ? { left: position.left, top: position.top, width: position.width, maxHeight: position.maxHeight } : { visibility: 'hidden', left: 0, top: 0, width: 290, maxHeight: 380 }) } as CSSProperties} onKeyDown={onKeyDown}>
      {searchable && <div className="select-menu-search"><Search size={14} aria-hidden="true" /><input ref={searchRef} role="combobox" aria-label={`${label}: ${t('搜索选项…')}`} aria-expanded="true" aria-controls={listId} aria-autocomplete="list" aria-activedescendant={active !== null ? optionIds.get(active) : undefined} placeholder={t(searchPlaceholder)} value={query} onChange={event => setQuery(event.target.value)} autoComplete="off" spellCheck={false} />{query && <button type="button" tabIndex={-1} aria-label={t('清空选项搜索')} onClick={() => { setQuery(''); searchRef.current?.focus(); }}><X size={12} /></button>}</div>}
      <div id={listId} className="select-menu-list" role="listbox" aria-label={label}>
        {groups.map((group, index) => <div className="select-menu-group" key={group.label || '__ungrouped'} role={group.label ? 'group' : undefined} aria-labelledby={group.label ? `${listId}-group-${index}` : undefined}>
          {group.label && <div id={`${listId}-group-${index}`} className="select-menu-group-label">{group.label}</div>}
          {group.options.map(option => <div key={option.value} id={optionIds.get(option.value)} data-value={option.value} ref={element => { if (element) optionRefs.current.set(option.value, element); else optionRefs.current.delete(option.value); }} className={`select-menu-option ${option.value === active ? 'is-active' : ''} ${option.value === value ? 'is-selected' : ''} ${option.disabled ? 'is-disabled' : ''}`} role="option" aria-label={option.label} aria-selected={option.value === value} aria-disabled={option.disabled || undefined} title={`${option.label}${option.description ? `\n${option.description}` : ''}`} onPointerMove={() => { if (!option.disabled && active !== option.value) setActive(option.value); }} onMouseDown={event => event.preventDefault()} onClick={() => choose(option)}>
            {option.icon && <span className="select-menu-option-icon" aria-hidden="true">{option.icon}</span>}<span className="select-menu-option-copy"><span className="select-menu-option-label">{option.label}</span>{option.description && <span className="select-menu-option-description">{option.description}</span>}</span><Check className="select-menu-check" size={14} aria-hidden="true" />
          </div>)}
        </div>)}
        {!visible.length && <div className="select-menu-empty">{t(query ? '没有匹配的选项' : '暂无可选项')}</div>}
      </div>
    </div>, document.body)}
  </div>;
}

export default SelectMenu;
