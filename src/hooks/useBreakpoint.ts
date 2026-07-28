import { useEffect, useState } from 'react';

/**
 * §5 — desktop ≥ 1080px, tablet 880–1079 (compact rail),
 * narrow tablet 720–879 (single mail column), below 720 a phone.
 *
 * `phone` was `too-narrow`, and the name was the whole of the design: under
 * 720px the shell rendered a sentence asking for a wider window. That is the
 * right answer for a desktop window someone has dragged too small and the
 * wrong one for the only width an iPhone has, so the band keeps its boundary
 * and changes its meaning — below 720px is a phone, and a phone gets a shell
 * of its own.
 */
export type Breakpoint = 'desktop' | 'tablet' | 'narrow' | 'phone';

/**
 * Deliberately `matchMedia` rather than `window.innerWidth`.
 *
 * `innerWidth` includes the horizontal overflow the page itself is causing, so
 * a layout that is one pane too wide reports a viewport wide enough to justify
 * that pane — and never recovers. `matchMedia` reflects the real viewport and
 * matches the media queries in the stylesheets, so JS and CSS agree by
 * construction.
 */
const QUERIES: { bp: Breakpoint; query: string }[] = [
  { bp: 'phone', query: '(max-width: 719px)' },
  { bp: 'narrow', query: '(min-width: 720px) and (max-width: 879px)' },
  { bp: 'tablet', query: '(min-width: 880px) and (max-width: 1079px)' },
  { bp: 'desktop', query: '(min-width: 1080px)' },
];

function current(): Breakpoint {
  if (typeof window === 'undefined' || !window.matchMedia) return 'desktop';
  return QUERIES.find(({ query }) => window.matchMedia(query).matches)?.bp ?? 'desktop';
}

/**
 * Whether the list and the reader share one column, so opening a thread
 * replaces the list rather than filling a pane beside it.
 *
 * Two widths answer yes for different reasons — a narrow tablet has no room
 * for both, a phone has no room for either at full size — and every caller
 * cares only about the answer. Written as `bp === 'narrow'` in four places
 * before the phone existed, which is four places that would each have had to
 * remember the new width.
 */
export function isSingleColumn(bp: Breakpoint): boolean {
  return bp === 'narrow' || bp === 'phone';
}

export function useBreakpoint(): Breakpoint {
  const [bp, setBp] = useState<Breakpoint>(current);

  useEffect(() => {
    if (!window.matchMedia) return;
    const update = () => setBp(current());
    const lists = QUERIES.map(({ query }) => window.matchMedia(query));
    lists.forEach((list) => list.addEventListener('change', update));
    // `resize` as well: some embedded webviews resize without firing a
    // media-query change, and a stale breakpoint is a broken layout.
    window.addEventListener('resize', update);
    update();
    return () => {
      lists.forEach((list) => list.removeEventListener('change', update));
      window.removeEventListener('resize', update);
    };
  }, []);

  return bp;
}
