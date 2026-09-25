import { useEffect, useState } from 'react';

export const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(Math.max(min, max), value));
export function usePanelSize(key: string, fallback: number, min: number, max: number) {
  const [size, setSize] = useState(() => {
    try { const value = localStorage.getItem(`gitvista.layout.${key}`); if (value !== null && Number.isFinite(Number(value))) return clamp(Number(value), min, max); } catch { /* 可选的本地偏好。 */ }
    return fallback;
  });
  useEffect(() => { const timer = setTimeout(() => { try { localStorage.setItem(`gitvista.layout.${key}`, String(size)); } catch { /* 只读环境仍允许本次调整。 */ } }, 200); return () => clearTimeout(timer); }, [key, size]);
  return [size, setSize] as const;
}
