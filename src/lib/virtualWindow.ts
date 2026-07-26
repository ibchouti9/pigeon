export interface VirtualWindowInput {
  scrollTop: number;
  viewportHeight: number;
  itemCount: number;
  rowHeight: number;
  overscan: number;
}

export interface VirtualWindow {
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
 * The windowing maths behind both hand-rolled virtualizers — O4's known-senders
 * list and Settings → Senders. Pure, so it can be tested at the boundaries the
 * hooks make awkward to reach.
 *
 * The clamp is the part that matters. `scrollTop` lives in component state and
 * is only updated by a scroll event, so a list that shrinks underneath it —
 * typing in a filter, switching tabs — leaves a scroll position pointing past
 * the end of the new list. Unclamped, `startIndex` lands beyond `endIndex`, the
 * slice comes back empty, and the list renders as blank space behind a spacer
 * thousands of pixels tall.
 */
export function virtualWindow({
  scrollTop,
  viewportHeight,
  itemCount,
  rowHeight,
  overscan,
}: VirtualWindowInput): VirtualWindow {
  if (itemCount <= 0) return { startIndex: 0, endIndex: 0, topPad: 0, bottomPad: 0 };

  const maxScrollTop = Math.max(0, itemCount * rowHeight - viewportHeight);
  const clamped = Math.min(Math.max(0, scrollTop), maxScrollTop);

  const visibleCount = Math.ceil(viewportHeight / rowHeight) + overscan * 2;
  const startIndex = Math.max(0, Math.floor(clamped / rowHeight) - overscan);
  const endIndex = Math.min(itemCount, startIndex + visibleCount);

  return {
    startIndex,
    endIndex,
    topPad: startIndex * rowHeight,
    bottomPad: Math.max(0, (itemCount - endIndex) * rowHeight),
  };
}
