import { describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useRowSwipe } from '../useRowSwipe';

/**
 * Swipe-to-archive: the gesture that replaces the hover button a phone has no
 * pointer to reveal.
 */
function touchEvent(points: { x: number; y: number }[]) {
  return {
    touches: points.map((p) => ({ clientX: p.x, clientY: p.y })),
  } as unknown as React.TouchEvent;
}

function start(result: { current: ReturnType<typeof useRowSwipe> }, x: number, y: number) {
  act(() => result.current.handlers.onTouchStart(touchEvent([{ x, y }])));
}

function move(result: { current: ReturnType<typeof useRowSwipe> }, x: number, y: number) {
  act(() => result.current.handlers.onTouchMove(touchEvent([{ x, y }])));
}

describe('useRowSwipe', () => {
  it('commits when the finger travels past the threshold and lets go', () => {
    const commit = vi.fn();
    const { result } = renderHook(() => useRowSwipe(commit, true));

    start(result, 300, 100);
    move(result, 280, 100);
    move(result, 200, 100);
    expect(result.current.offset).toBe(-100);
    expect(result.current.active).toBe(true);

    act(() => result.current.handlers.onTouchEnd());
    expect(commit).toHaveBeenCalledOnce();
    // And springs back, rather than resting open.
    expect(result.current.offset).toBe(0);
    expect(result.current.active).toBe(false);
  });

  it('springs back without committing when the travel is short', () => {
    const commit = vi.fn();
    const { result } = renderHook(() => useRowSwipe(commit, true));

    start(result, 300, 100);
    move(result, 280, 100);
    move(result, 240, 100);
    act(() => result.current.handlers.onTouchEnd());

    expect(commit).not.toHaveBeenCalled();
    expect(result.current.offset).toBe(0);
  });

  /*
   * The bug this guards: deciding the axis per frame meant a thumb travelling
   * down and slightly left flickered between scrolling the list and dragging a
   * row, and archived whichever row it happened to be over when it stopped.
   */
  it('decides the axis once, and a vertical start stays a scroll', () => {
    const commit = vi.fn();
    const { result } = renderHook(() => useRowSwipe(commit, true));

    start(result, 300, 100);
    // Down first — this is a scroll.
    move(result, 298, 140);
    // Now hard left. The gesture is already a scroll and must stay one.
    move(result, 100, 140);

    expect(result.current.offset).toBe(0);
    expect(result.current.active).toBe(false);

    act(() => result.current.handlers.onTouchEnd());
    expect(commit).not.toHaveBeenCalled();
  });

  /*
   * The bug this guards, and it took a device to find: the release decided
   * from the `offset` state variable, which is the value from the render that
   * installed the handler. A gesture whose last move and release arrive in one
   * turn — which is what a quick flick delivers — released against a stale
   * zero and archived nothing.
   *
   * Every other test here hid it, because `act()` forces a render between each
   * event and a real device promises no such thing.
   */
  it('commits on a move and release that never render in between', () => {
    const commit = vi.fn();
    const { result } = renderHook(() => useRowSwipe(commit, true));

    act(() => {
      result.current.handlers.onTouchStart(touchEvent([{ x: 300, y: 100 }]));
      result.current.handlers.onTouchMove(touchEvent([{ x: 180, y: 100 }]));
      result.current.handlers.onTouchEnd();
    });

    expect(commit).toHaveBeenCalledOnce();
  });

  /* A right swipe here would promise a second action that does not exist. */
  it('does not travel right', () => {
    const { result } = renderHook(() => useRowSwipe(vi.fn(), true));

    start(result, 100, 100);
    move(result, 200, 100);
    expect(result.current.offset).toBe(0);
  });

  it('resists past the maximum rather than following the finger off the row', () => {
    const { result } = renderHook(() => useRowSwipe(vi.fn(), true));

    start(result, 400, 100);
    move(result, 380, 100);
    // 300px of travel; the row must not have moved 300px.
    move(result, 100, 100);
    expect(result.current.offset).toBeLessThan(-120);
    expect(result.current.offset).toBeGreaterThanOrEqual(-144);
  });

  /* Sent and Drafts have nowhere to archive to; selection mode owns the drag. */
  it('does nothing at all when disabled', () => {
    const commit = vi.fn();
    const { result } = renderHook(() => useRowSwipe(commit, false));

    start(result, 300, 100);
    move(result, 150, 100);
    act(() => result.current.handlers.onTouchEnd());

    expect(result.current.offset).toBe(0);
    expect(commit).not.toHaveBeenCalled();
  });

  it('abandons the gesture when the system cancels the touch', () => {
    const commit = vi.fn();
    const { result } = renderHook(() => useRowSwipe(commit, true));

    start(result, 300, 100);
    move(result, 150, 100);
    act(() => result.current.handlers.onTouchCancel());

    expect(commit).not.toHaveBeenCalled();
    expect(result.current.offset).toBe(0);
  });
});
