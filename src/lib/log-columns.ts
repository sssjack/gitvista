export type LogColumn = 'graph' | 'subject' | 'author' | 'date' | 'hash';
export type LogColumnWidths = Partial<Record<LogColumn, number>>;
export const LOG_COLUMN_LIMITS: Record<LogColumn, { min: number; max: number }> = {
  graph: { min: 64, max: 2048 }, subject: { min: 140, max: 8192 },
  author: { min: 64, max: 2048 }, date: { min: 88, max: 2048 }, hash: { min: 64, max: 2048 },
};
export const LOG_COLUMNS_KEY = 'gitvista.logColumns';
export function clampColumnWidth(column: LogColumn, width: number): number {
  const { min, max } = LOG_COLUMN_LIMITS[column];
  // Preserve fractional pointer movement at non-integer display scaling.
  return Math.max(min, Math.min(max, width));
}
export function readLogColumnWidths(): LogColumnWidths {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(LOG_COLUMNS_KEY) || '{}');
    if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return {};
    const widths: LogColumnWidths = {};
    for (const key of Object.keys(LOG_COLUMN_LIMITS) as LogColumn[]) {
      const value = (stored as Record<string, unknown>)[key];
      if (typeof value === 'number' && Number.isFinite(value)) widths[key] = clampColumnWidth(key, value);
    }
    return widths;
  } catch { return {}; }
}
