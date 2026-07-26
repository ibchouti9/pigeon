import { useEffect, useRef, useState, type RefObject } from 'react';
import { virtualWindow } from '../../lib/virtualWindow';

export interface VirtualList {
  containerRef: RefObject<HTMLDivElement | null>;
  /** Index of the first item to render. */
  startIndex: number;
  /** Index one past the last item to render. */
  endIndex: number;
  /** Spacer height above the rendered slice. */
  topPad: number;
  /** Spacer height below the rendered slice. */
  bottomPad: number;
}

/**
 * O4's known-senders list (~342 rows) is windowed by hand rather than
 * pulling in a dependency: fixed row height, slice the array by scrollTop.
 */
export function useVirtualList(itemCount: number, rowHeight: number, overscan = 8): VirtualList {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    setViewportHeight(el.clientHeight);

    const onScroll = () => setScrollTop(el.scrollTop);
    el.addEventListener('scroll', onScroll);

    let ro: ResizeObserver | undefined;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(() => setViewportHeight(el.clientHeight));
      ro.observe(el);
    }

    return () => {
      el.removeEventListener('scroll', onScroll);
      ro?.disconnect();
    };
  }, []);

  // A shrinking list also has to move the scroll position itself, or the
  // container stays scrolled past its own new content.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const maxScroll = Math.max(0, itemCount * rowHeight - el.clientHeight);
    if (el.scrollTop > maxScroll) {
      el.scrollTop = maxScroll;
      setScrollTop(maxScroll);
    }
  }, [itemCount, rowHeight]);

  const window_ = virtualWindow({
    scrollTop,
    viewportHeight,
    itemCount,
    rowHeight,
    overscan,
  });

  return { containerRef, ...window_ };
}
