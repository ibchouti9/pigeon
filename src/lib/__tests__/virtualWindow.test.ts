import { describe, expect, it } from 'vitest';
import { virtualWindow } from '../virtualWindow';

const ROW = 44;
const VIEWPORT = 440;

function windowFor(itemCount: number, scrollTop: number) {
  return virtualWindow({ scrollTop, viewportHeight: VIEWPORT, itemCount, rowHeight: ROW, overscan: 8 });
}

describe('virtualWindow', () => {
  it('renders from the top when unscrolled', () => {
    const w = windowFor(342, 0);
    expect(w.startIndex).toBe(0);
    expect(w.topPad).toBe(0);
    expect(w.endIndex).toBeGreaterThan(10);
  });

  it('slides the window down as it scrolls', () => {
    const w = windowFor(342, 100 * ROW);
    expect(w.startIndex).toBe(92); // 100 minus the 8-row overscan
    expect(w.topPad).toBe(92 * ROW);
  });

  it('adds up to the full list height at any scroll position', () => {
    for (const top of [0, 500, 5000, 15_000]) {
      const w = windowFor(342, top);
      const rendered = (w.endIndex - w.startIndex) * ROW;
      expect(w.topPad + rendered + w.bottomPad).toBe(342 * ROW);
    }
  });

  describe('when the list shrinks under a stale scroll position', () => {
    // Filtering "Find a sender" down, or switching Senders tabs, changes the
    // count without touching scrollTop.
    it('never starts the slice after it ends', () => {
      const w = windowFor(5, 200 * ROW);
      expect(w.startIndex).toBeLessThanOrEqual(w.endIndex);
    });

    it('renders rows rather than blank space behind a huge spacer', () => {
      const w = windowFor(5, 200 * ROW);
      expect(w.endIndex - w.startIndex).toBeGreaterThan(0);
      expect(w.topPad).toBeLessThanOrEqual(5 * ROW);
    });

    it('holds the invariant across a sweep of counts and positions', () => {
      for (const count of [0, 1, 2, 5, 40, 342]) {
        for (const top of [0, 44, 4400, 15_048, 99_999]) {
          const w = windowFor(count, top);
          expect(w.startIndex).toBeGreaterThanOrEqual(0);
          expect(w.endIndex).toBeLessThanOrEqual(count);
          expect(w.startIndex).toBeLessThanOrEqual(w.endIndex);
          expect(w.topPad).toBeGreaterThanOrEqual(0);
          expect(w.bottomPad).toBeGreaterThanOrEqual(0);
        }
      }
    });
  });

  it('returns an empty window for an empty list', () => {
    expect(windowFor(0, 0)).toEqual({ startIndex: 0, endIndex: 0, topPad: 0, bottomPad: 0 });
  });

  it('ignores a negative scroll position', () => {
    expect(windowFor(342, -200).startIndex).toBe(0);
  });
});
