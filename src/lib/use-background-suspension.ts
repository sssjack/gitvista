import { useEffect, useState } from 'react';

/** Keep drafts in the workbench, but allow read-only panels to release their data. */
export function useBackgroundSuspension(): boolean {
  const [suspended, setSuspended] = useState(false);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const changed = () => {
      clearTimeout(timer);
      if (document.hidden) timer = setTimeout(() => setSuspended(true), 60_000);
      else setSuspended(false);
    };
    document.addEventListener('visibilitychange', changed); changed();
    return () => { clearTimeout(timer); document.removeEventListener('visibilitychange', changed); };
  }, []);
  return suspended;
}
