import { describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { usePullToRefresh } from '../usePullToRefresh';

/** A scroll container parked wherever the test wants it. */
function scroller(scrollTop = 0) {
  return { current: { scrollTop } as HTMLElement };
}

function touchEvent(points: { x: number; y: number }[]) {
  return { touches: points.map((p) => ({ clientX: p.x, clientY: p.y })) } as unknown as React.TouchEvent;
}

type Hook = { current: ReturnType<typeof usePullToRefresh> };

function drag(hook: Hook, from: { x: number; y: number }, ...to: { x: number; y: number }[]) {
  act(() => hook.current.handlers.onTouchStart(touchEvent([from])));
  for (const point of to) {
    act(() => hook.current.handlers.onTouchMove(touchEvent([point])));
  }
}

describe('usePullToRefresh', () => {
  it('refreshes when pulled past the threshold and released', async () => {
    const onRefresh = vi.fn(async () => {});
    const { result } = renderHook(() => usePullToRefresh(scroller(), onRefresh));

    drag(result, { x: 200, y: 100 }, { x: 200, y: 110 }, { x: 200, y: 300 });
    // Half of 200px of travel, capped at 96.
    expect(result.current.distance).toBe(96);
    expect(result.current.armed).toBe(true);

    act(() => result.current.handlers.onTouchEnd());
    expect(onRefresh).toHaveBeenCalledOnce();
    await waitFor(() => expect(result.current.refreshing).toBe(false));
    expect(result.current.distance).toBe(0);
  });

  /* A short tug is someone reaching the top of the list, not asking for mail. */
  it('springs back without refreshing when the pull is short', () => {
    const onRefresh = vi.fn(async () => {});
    const { result } = renderHook(() => usePullToRefresh(scroller(), onRefresh));

    drag(result, { x: 200, y: 100 }, { x: 200, y: 110 }, { x: 200, y: 160 });
    expect(result.current.distance).toBe(30);
    expect(result.current.armed).toBe(false);

    act(() => result.current.handlers.onTouchEnd());
    expect(onRefresh).not.toHaveBeenCalled();
    expect(result.current.distance).toBe(0);
  });

  /*
   * The gesture this shares its rows with. A drag that starts sideways belongs
   * to `useRowSwipe`, and both of them deciding the axis once is what keeps a
   * diagonal thumb from doing two things at the same time.
   */
  it('leaves a sideways drag to the row underneath', () => {
    const onRefresh = vi.fn(async () => {});
    const { result } = renderHook(() => usePullToRefresh(scroller(), onRefresh));

    drag(result, { x: 300, y: 100 }, { x: 280, y: 104 }, { x: 100, y: 200 });
    expect(result.current.distance).toBe(0);

    act(() => result.current.handlers.onTouchEnd());
    expect(onRefresh).not.toHaveBeenCalled();
  });

  /*
   * The scroll position is read once, at touchstart. A list already scrolled
   * down is scrolling — re-checking mid-drag would turn the moment it reached
   * the top into the start of a pull, mid-flick.
   */
  it('does nothing when the list is not already at the top', () => {
    const onRefresh = vi.fn(async () => {});
    const { result } = renderHook(() => usePullToRefresh(scroller(240), onRefresh));

    drag(result, { x: 200, y: 100 }, { x: 200, y: 300 });
    expect(result.current.distance).toBe(0);

    act(() => result.current.handlers.onTouchEnd());
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it('holds the gap open while the refresh runs', async () => {
    let settle: () => void = () => {};
    const onRefresh = vi.fn(() => new Promise<void>((r) => (settle = r)));
    const { result } = renderHook(() => usePullToRefresh(scroller(), onRefresh));

    drag(result, { x: 200, y: 100 }, { x: 200, y: 110 }, { x: 200, y: 300 });
    act(() => result.current.handlers.onTouchEnd());

    // The spinner is the only evidence the gesture was received; snapping shut
    // on release makes a pull feel like it did nothing.
    expect(result.current.refreshing).toBe(true);
    expect(result.current.distance).toBeGreaterThan(0);

    await act(async () => {
      settle();
    });
    expect(result.current.refreshing).toBe(false);
    expect(result.current.distance).toBe(0);
  });

  /* A refresh that throws still has to stop looking busy. */
  it('recovers when the refresh fails', async () => {
    const onRefresh = vi.fn(async () => {
      throw new Error('offline');
    });
    const { result } = renderHook(() => usePullToRefresh(scroller(), onRefresh));

    drag(result, { x: 200, y: 100 }, { x: 200, y: 110 }, { x: 200, y: 300 });
    act(() => result.current.handlers.onTouchEnd());

    await waitFor(() => expect(result.current.refreshing).toBe(false));
    expect(result.current.distance).toBe(0);
  });

  /* The same batching hazard `useRowSwipe` carries: one turn, no render. */
  it('refreshes on a pull and release that never render in between', () => {
    const onRefresh = vi.fn(async () => {});
    const { result } = renderHook(() => usePullToRefresh(scroller(), onRefresh));

    act(() => {
      result.current.handlers.onTouchStart(touchEvent([{ x: 200, y: 100 }]));
      result.current.handlers.onTouchMove(touchEvent([{ x: 200, y: 300 }]));
      result.current.handlers.onTouchEnd();
    });

    expect(onRefresh).toHaveBeenCalledOnce();
  });

  it('does nothing at all when disabled', () => {
    const onRefresh = vi.fn(async () => {});
    const { result } = renderHook(() => usePullToRefresh(scroller(), onRefresh, false));

    drag(result, { x: 200, y: 100 }, { x: 200, y: 300 });
    act(() => result.current.handlers.onTouchEnd());

    expect(result.current.distance).toBe(0);
    expect(onRefresh).not.toHaveBeenCalled();
  });
});
