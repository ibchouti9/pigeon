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
 * stealing focus on load would fight the skip link.
 *
 * A screen that places focus itself keeps it. §8.4 gives the Screener card
 * focus on route entry so its single-key shortcuts work, and this used to
 * overwrite that with the heading: React runs child effects before parent
 * ones, so the card focused first and the shell took it back a moment later.
 * The comment here used to claim the opposite ordering, which is why it went
 * unnoticed — the check below is on what actually has focus, not on who ran
 * when.
 */
export function useRouteFocus(regionRef: React.RefObject<HTMLElement | null>): void {
  // The region, not the URL. Opening a thread changes the path but not the
  // screen — the list column stays put and the reader swaps beside it — so
  // grabbing the heading there would yank focus off the row the user just
  // opened, and fight the reader's own "focus back to the row on close".
  const region = useLocation().pathname.split('/')[1] ?? '';
  const first = useRef(true);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }

    const region = regionRef.current;
    if (!region) return;

    // Something inside the new screen already claimed focus, so leave it there.
    const active = document.activeElement;
    if (active && active !== document.body && region.contains(active)) return;

    const heading = region.querySelector<HTMLElement>('h1');
    if (!heading) return;
    heading.tabIndex = -1;
    heading.focus({ preventScroll: true });
  }, [region, regionRef]);
}
