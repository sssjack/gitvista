import type { AppPreferences } from '../../shared/types';

export const UI_FONT_SCALES: Record<AppPreferences['uiFontSize'], number> = { small: 0.9, normal: 1, large: 1.1, extraLarge: 1.2 };
export const UI_FONT_OPTIONS: { value: AppPreferences['uiFontSize']; label: string }[] = [
  { value: 'small', label: '小' }, { value: 'normal', label: '标准' }, { value: 'large', label: '大' }, { value: 'extraLarge', label: '特大' },
];
export function applyUiFontSize(size: AppPreferences['uiFontSize']): void {
  document.documentElement.style.setProperty('--ui-font-scale', String(UI_FONT_SCALES[size] || 1));
}
