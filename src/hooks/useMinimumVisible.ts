import { useEffect, useRef, useState } from 'react';

/**
 * C-21 — a skeleton is "rendered for a minimum of 200ms once shown, to avoid a
 * flash". Every loading state was driven straight off its status flag, so a
 * provider that answered in 40ms produced a 40ms flicker of skeleton rows,
 * which reads as a glitch rather than as loading.
 *
 * Returns `true` while `active` is true, and keeps returning `true` for
 * `minimumMs` after it goes false. Turning on is never delayed — only turning
 * off is, and only when it happened too soon to have been seen.
 */
export function useMinimumVisible(active: boolean, minimumMs = 200): boolean {
  const [visible, setVisible] = useState(active);
  const shownAt = useRef<number | null>(active ? performance.now() : null);

  useEffect(() => {
    if (active) {
      if (shownAt.current === null) shownAt.current = performance.now();
      setVisible(true);
      return;
    }

    if (shownAt.current === null) {
      setVisible(false);
      return;
    }

    const elapsed = performance.now() - shownAt.current;
    shownAt.current = null;
    if (elapsed >= minimumMs) {
      setVisible(false);
      return;
    }

    const timer = setTimeout(() => setVisible(false), minimumMs - elapsed);
    return () => clearTimeout(timer);
  }, [active, minimumMs]);

  return visible;
}
