import { useEffect, useState } from 'react';

/**
 * §5 — desktop ≥ 1080px, tablet 880–1079 (compact rail),
 * narrow tablet 720–879 (single mail column), below 720 the width message.
 */
export type Breakpoint = 'desktop' | 'tablet' | 'narrow' | 'too-narrow';

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
  { bp: 'too-narrow', query: '(max-width: 719px)' },
  { bp: 'narrow', query: '(min-width: 720px) and (max-width: 879px)' },
  { bp: 'tablet', query: '(min-width: 880px) and (max-width: 1079px)' },
  { bp: 'desktop', query: '(min-width: 1080px)' },
];

function current(): Breakpoint {
  if (typeof window === 'undefined' || !window.matchMedia) return 'desktop';
  return QUERIES.find(({ query }) => window.matchMedia(query).matches)?.bp ?? 'desktop';
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
