import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { DesktopState, MiniFrame } from '../shared/types';
import MiniBar from './components/MiniBar';
import { I18nProvider } from './lib/i18n';
import './styles.css';

function MiniApp() {
  const [state, setState] = useState<DesktopState | null>(null);
  useEffect(() => {
    const accept = (value: DesktopState) => {
      if (!value) return;
      document.documentElement.dataset.theme = value.theme;
      frame(value.frame);
      setState(value);
    };
    const frame = (value: MiniFrame) => {
      for (const key of ['x', 'y', 'width', 'height'] as const) document.documentElement.style.setProperty(`--mini-${key}`, `${value[key]}px`);
    };
    const unsubscribe = window.gitvistaMini.onDesktopState(accept);
    const unsubscribeFrame = window.gitvistaMini.onFrame(frame);
    void window.gitvistaMini.desktopState().then(accept);
    return () => { unsubscribe(); unsubscribeFrame(); };
  }, []);
  return state ? <I18nProvider language={state.language}><MiniBar state={state} /></I18nProvider> : null;
}

createRoot(document.getElementById('root')!).render(<MiniApp />);
