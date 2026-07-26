import { useEffect } from 'react';
import { useSettings } from '../store/settings';

/**
 * D1 — light is the default; dark follows the OS unless overridden in
 * Settings → Account → Appearance. "System" removes the attribute entirely so
 * the prefers-color-scheme block in tokens.css takes over.
 */
export function useTheme(): void {
  const appearance = useSettings((s) => s.appearance);

  useEffect(() => {
    const root = document.documentElement;
    if (appearance === 'system') {
      root.removeAttribute('data-theme');
    } else {
      root.setAttribute('data-theme', appearance);
    }
  }, [appearance]);
}
