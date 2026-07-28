import { useRef, useState, type RefObject } from 'react';

/** How far the finger must travel, after resistance, to arm the refresh. */
const THRESHOLD = 64;
/** The furthest the list will follow, however hard it is pulled. */
const MAX = 96;
/** Below this, the gesture has not decided whether it is a pull or a swipe. */
const AXIS_PX = 6;
/**
 * How much of the finger's travel the list actually follows.
 *
 * Half. The resistance is what makes a pull feel like a pull rather than a
 * scroll that went wrong, and it is also what keeps the threshold out of reach
 * of the small downward drift in an ordinary tap.
 */
const FOLLOW = 0.5;

export interface PullToRefresh {
  /** How far the list is currently displaced, in pixels. */
  distance: number;
  /** True from release until the refresh settles. */
  refreshing: boolean;
  /** Past the threshold — releasing now will refresh. */
  armed: boolean;
  handlers: {
    onTouchStart: (e: React.TouchEvent) => void;
    onTouchMove: (e: React.TouchEvent) => void;
    onTouchEnd: () => void;
    onTouchCancel: () => void;
  };
}

/**
 * Pull down at the top of a list to fetch again.
 *
 * The gesture every mail client on this platform has, and the one people reach
 * for before they look for a button. Pigeon had a refresh on a timer, one on
 * window focus and one on the engine's IDLE event, and no way at all to say
 * "check now" — which is exactly what someone does when they are expecting
 * something.
 *
 * Two gestures share these rows: this one and swipe-to-archive. They cannot
 * both claim a drag, so the axis is decided once, on the first few pixels, and
 * never revisited — the same rule `useRowSwipe` follows, for the same reason.
 * A pull that starts sideways stays sideways.
 *
 * The scroll position is read at `touchstart` and not after. A list already
 * scrolled down is scrolling, not pulling, and re-checking mid-gesture would
 * turn the moment it reaches the top into the start of a pull.
 */
export function usePullToRefresh(
  scrollRef: RefObject<HTMLElement | null>,
  onRefresh: () => void | Promise<void>,
  enabled = true,
): PullToRefresh {
  const [distance, setDistance] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const start = useRef<{ x: number; y: number } | null>(null);
  const axis = useRef<'undecided' | 'pull' | 'other'>('undecided');

  /*
   * The same number as `distance`, kept where the release can read it. React
   * may batch the last `touchmove` with the `touchend` that follows it, and a
   * release that reads the state variable then reads the value from before the
   * gesture — zero — and decides nothing happened. `useRowSwipe` carries the
   * same guard for the same reason.
   */
  const pulled = useRef(0);

  function pull(next: number) {
    pulled.current = next;
    setDistance(next);
  }

  function reset() {
    start.current = null;
    axis.current = 'undecided';
    pull(0);
  }

  return {
    distance,
    refreshing,
    armed: distance >= THRESHOLD,
    handlers: {
      onTouchStart(e) {
        if (!enabled || refreshing || e.touches.length !== 1) return;
        // At the very top, or not a pull at all.
        if ((scrollRef.current?.scrollTop ?? 0) > 0) return;
        const t = e.touches[0];
        start.current = { x: t.clientX, y: t.clientY };
        axis.current = 'undecided';
      },
      onTouchMove(e) {
        const from = start.current;
        if (!from || e.touches.length !== 1) return;
        const t = e.touches[0];
        const dx = t.clientX - from.x;
        const dy = t.clientY - from.y;

        if (axis.current === 'undecided') {
          if (Math.abs(dx) < AXIS_PX && Math.abs(dy) < AXIS_PX) return;
          // Downward, and more downward than sideways. Anything else belongs
          // to the row underneath or to the scroller.
          axis.current = dy > 0 && dy > Math.abs(dx) ? 'pull' : 'other';
        }
        if (axis.current !== 'pull') return;

        pull(Math.min(MAX, dy * FOLLOW));
      },
      onTouchEnd() {
        const armed = axis.current === 'pull' && pulled.current >= THRESHOLD;
        if (!armed) {
          reset();
          return;
        }

        /*
         * Held open while the refresh runs, then released. Snapping shut on
         * release and leaving the work to happen invisibly is how a pull comes
         * to feel like it did nothing — the spinner is the only evidence the
         * gesture was received.
         */
        start.current = null;
        axis.current = 'undecided';
        setRefreshing(true);
        pull(THRESHOLD);

        void Promise.resolve(onRefresh())
          .catch(() => {
            // A failed refresh is the provider's story to tell — the banner
            // and the list's own error state already do. The gesture's only
            // job is to stop looking busy.
          })
          .finally(() => {
            setRefreshing(false);
            pull(0);
          });
      },
      onTouchCancel: reset,
    },
  };
}
