import { useRef, useState } from 'react';
import { haptic } from '../../lib/haptics';

/** Past this much travel, releasing commits the action. */
const COMMIT_PX = 88;
/** Beyond this the row stops following the finger, so the edge feels like one. */
const MAX_PX = 120;
/** Below this, the gesture has not decided whether it is a scroll yet. */
const AXIS_PX = 8;

export interface RowSwipe {
  /** Current travel, 0 to -MAX_PX. Drives the transform and the backing tint. */
  offset: number;
  /** True once the finger has committed to the horizontal axis. */
  active: boolean;
  handlers: {
    onTouchStart: (e: React.TouchEvent) => void;
    onTouchMove: (e: React.TouchEvent) => void;
    onTouchEnd: () => void;
    onTouchCancel: () => void;
  };
}

/**
 * Swipe a row left to archive it — the gesture the hover button becomes when
 * there is no pointer to hover with.
 *
 * There is no resting open state. iOS offers one: swipe part-way, let go, and
 * the row sits with its actions showing until you tap one. That is worth it
 * when the drawer holds three or four choices; here it holds exactly one, and
 * an intermediate state you can leave a row parked in costs a second gesture
 * to reach the same place a full swipe reaches in the first. Past the
 * threshold it archives, short of it the row springs back.
 *
 * The axis is decided once per gesture and never revisited. Deciding per frame
 * meant a thumb travelling down and slightly left flickered between scrolling
 * the list and dragging the row, and the row it eventually archived was rarely
 * the one under the thumb when the gesture started. The list's own vertical
 * scroll is left to the browser via `touch-action: pan-y`, which is also why
 * none of this needs to call `preventDefault` — a listener that does is
 * passive by default and would have to be attached by hand.
 */
export function useRowSwipe(onCommit: () => void, enabled: boolean): RowSwipe {
  const [offset, setOffset] = useState(0);
  const [active, setActive] = useState(false);
  const start = useRef<{ x: number; y: number } | null>(null);
  const axis = useRef<'undecided' | 'x' | 'y'>('undecided');

  /*
   * The same number as `offset`, kept where the release can read it.
   *
   * `onTouchEnd` decided from the state variable, which is the value from the
   * render that installed the handler — so a gesture whose last `touchmove`
   * and `touchend` arrive in one turn, with no render between, released
   * against a stale zero and archived nothing. React is free to batch those; a
   * ref is not.
   *
   * The tests did not catch it because `act()` forces a render between every
   * event, which is exactly what a real device does not promise.
   */
  const travelled = useRef(0);

  function slide(next: number) {
    travelled.current = next;
    setOffset(next);
  }

  function reset() {
    start.current = null;
    axis.current = 'undecided';
    slide(0);
    setActive(false);
  }

  return {
    offset,
    active,
    handlers: {
      onTouchStart(e) {
        if (!enabled || e.touches.length !== 1) return;
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
          axis.current = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
          if (axis.current === 'x') setActive(true);
        }
        if (axis.current !== 'x') return;

        /*
         * Left only. A right-swipe on a row means nothing here, and letting
         * the row travel right anyway would promise a second action that does
         * not exist.
         */
        const travel = Math.min(0, dx);
        // Past MAX_PX the row keeps moving at a third of the finger's speed,
        // which is what makes the limit read as resistance rather than a stop.
        const eased =
          travel > -MAX_PX ? travel : -MAX_PX + (travel + MAX_PX) / 3;
        slide(Math.max(eased, -MAX_PX - 24));
      },
      onTouchEnd() {
        const committed = axis.current === 'x' && travelled.current <= -COMMIT_PX;
        reset();
        if (!committed) return;
        // The row is about to leave; the tap is what says the gesture landed
        // rather than that the finger slipped.
        haptic('tick');
        onCommit();
      },
      onTouchCancel: reset,
    },
  };
}

export { COMMIT_PX };
