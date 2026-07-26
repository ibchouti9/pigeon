import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';

/**
 * §8.2 — "focus moves only on: route change (to the region's first heading,
 * which carries `tabindex="-1"`) …". Nothing did this, so pressing `g i` or
 * `g a` left focus on whatever had it before — usually the body — and a
 * keyboard or screen-reader user arrived on a new screen with no position in
 * it and no announcement of where they were.
 *
 * Deliberately not on first mount: the user has not navigated anywhere yet, and
 * stealing focus on load would fight the skip link. Screens that place focus
 * themselves (§8.4's Screener card) run their own effect afterwards and win.
 */
export function useRouteFocus(regionRef: React.RefObject<HTMLElement | null>): void {
  const { pathname } = useLocation();
  const first = useRef(true);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }

    const heading = regionRef.current?.querySelector<HTMLElement>('h1');
    if (!heading) return;
    heading.tabIndex = -1;
    heading.focus({ preventScroll: true });
  }, [pathname, regionRef]);
}
