import { useEffect, useRef, useState, type RefObject } from 'react';

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

  const visibleCount = Math.ceil(viewportHeight / rowHeight) + overscan * 2;
  const startIndex = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
  const endIndex = Math.min(itemCount, startIndex + visibleCount);

  return {
    containerRef,
    startIndex,
    endIndex,
    topPad: startIndex * rowHeight,
    bottomPad: Math.max(0, (itemCount - endIndex) * rowHeight),
  };
}
