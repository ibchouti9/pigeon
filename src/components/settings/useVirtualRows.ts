import { useEffect, useRef, useState } from 'react';
import { virtualWindow } from '../../lib/virtualWindow';

export interface VirtualRows {
  containerRef: React.RefObject<HTMLDivElement | null>;
  /** First row index to render. */
  startIndex: number;
  /** One past the last row index to render. */
  endIndex: number;
  /** Spacer height above the rendered band, in px. */
  topPad: number;
  /** Spacer height below the rendered band, in px. */
  bottomPad: number;
}

const OVERSCAN = 4;
/** Sensible desktop default used before the container has a measured height
 * (also keeps this correct in environments — like jsdom — that never lay
 * out real pixels). */
const FALLBACK_VIEWPORT = 720;

/**
 * Minimal fixed-row-height list virtualizer. Renders only the rows the
 * scroll container is actually showing, plus a small overscan band. No
 * dependency — just `scrollTop` and the container's measured height.
 */
export function useVirtualRows(count: number, rowHeight: number): VirtualRows {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewport, setViewport] = useState(FALLBACK_VIEWPORT);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const onScroll = () => setScrollTop(el.scrollTop);
    const measure = () => {
      if (el.clientHeight > 0) setViewport(el.clientHeight);
    };

    measure();
    el.addEventListener('scroll', onScroll);

    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(measure);
      ro.observe(el);
      return () => {
        el.removeEventListener('scroll', onScroll);
        ro.disconnect();
      };
    }
    window.addEventListener('resize', measure);
    return () => {
      el.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', measure);
    };
  }, []);

  // A shrinking list also has to move the scroll position itself, or the
  // container stays scrolled past its own new content.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const maxScroll = Math.max(0, count * rowHeight - el.clientHeight);
    if (el.scrollTop > maxScroll) {
      el.scrollTop = maxScroll;
      setScrollTop(maxScroll);
    }
  }, [count, rowHeight]);

  return {
    containerRef,
    ...virtualWindow({
      scrollTop,
      viewportHeight: viewport,
      itemCount: count,
      rowHeight,
      overscan: OVERSCAN,
    }),
  };
}
