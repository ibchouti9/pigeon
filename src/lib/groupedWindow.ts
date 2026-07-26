/**
 * Windowing for a list of fixed-height rows broken up by fixed-height group
 * headers — §5.5's thread list, where 56px rows sit under sticky 32px date
 * headers.
 *
 * `virtualWindow` handles a list where every item is the same height, which is
 * true of O4 and of Settings → Senders but not here. Rather than give up and
 * render everything, this flattens the groups into one sequence and walks it
 * once to find the slice that covers the viewport.
 *
 * Pure, and separate from the component, because the arithmetic is where this
 * kind of thing goes wrong and a component test cannot reach the edges: an
 * empty group, a scroll position past the end, a viewport taller than the list.
 */

export interface GroupedItem<T> {
  kind: 'header' | 'row';
  /** The group's label. Present on both kinds so a row knows where it sits. */
  label: string;
  /** Only on rows. */
  value?: T;
  /** Index among rows alone, ignoring headers — what the keyboard cursor uses. */
  rowIndex?: number;
}

export interface GroupedWindow<T> {
  items: GroupedItem<T>[];
  topPad: number;
  bottomPad: number;
  /** Total height of everything, rendered or not. */
  totalHeight: number;
}

export interface GroupedWindowInput<T> {
  groups: { label: string; rows: T[] }[];
  scrollTop: number;
  viewportHeight: number;
  rowHeight: number;
  headerHeight: number;
  /** Rows rendered beyond each edge, to cover fast scrolling. */
  overscan: number;
}

/** Flattens groups into the sequence the list actually renders. */
export function flattenGroups<T>(groups: { label: string; rows: T[] }[]): GroupedItem<T>[] {
  const items: GroupedItem<T>[] = [];
  let rowIndex = 0;

  for (const group of groups) {
    // A group with no rows has nothing to head.
    if (group.rows.length === 0) continue;
    items.push({ kind: 'header', label: group.label });
    for (const value of group.rows) {
      items.push({ kind: 'row', label: group.label, value, rowIndex });
      rowIndex += 1;
    }
  }

  return items;
}

export function groupedWindow<T>({
  groups,
  scrollTop,
  viewportHeight,
  rowHeight,
  headerHeight,
  overscan,
}: GroupedWindowInput<T>): GroupedWindow<T> {
  const all = flattenGroups(groups);
  const heightOf = (item: GroupedItem<T>) => (item.kind === 'header' ? headerHeight : rowHeight);

  const totalHeight = all.reduce((sum, item) => sum + heightOf(item), 0);
  if (all.length === 0) return { items: [], topPad: 0, bottomPad: 0, totalHeight: 0 };

  // Clamped for the same reason the flat virtualizer clamps: `scrollTop` lives
  // in state and a list that shrinks underneath it — archiving, filtering —
  // leaves a position past the end, which would otherwise render nothing at all
  // behind a spacer thousands of pixels tall.
  const maxScrollTop = Math.max(0, totalHeight - viewportHeight);
  const top = Math.min(Math.max(0, scrollTop), maxScrollTop);
  const bottom = top + viewportHeight;

  const overscanPx = overscan * rowHeight;
  let offset = 0;
  let startIndex = 0;
  let topPad = 0;
  let started = false;
  let endIndex = all.length;

  for (let i = 0; i < all.length; i++) {
    const height = heightOf(all[i]);
    const itemBottom = offset + height;

    if (!started && itemBottom > top - overscanPx) {
      startIndex = i;
      topPad = offset;
      started = true;
    }
    if (started && offset > bottom + overscanPx) {
      endIndex = i;
      break;
    }
    offset = itemBottom;
  }

  if (!started) {
    // Everything is above the viewport, which only happens if the list shrank
    // between the clamp and here. Show the tail rather than nothing.
    startIndex = all.length;
    topPad = totalHeight;
  }

  const items = all.slice(startIndex, endIndex);
  const renderedHeight = items.reduce((sum, item) => sum + heightOf(item), 0);

  return {
    items,
    topPad,
    bottomPad: Math.max(0, totalHeight - topPad - renderedHeight),
    totalHeight,
  };
}

/**
 * Where a row sits from the top of the list, counting the headers above it.
 *
 * Needed because a windowed row that is off screen has no DOM node to call
 * `scrollIntoView` on — so `j` past the fold moved the cursor to a row nobody
 * could see, which is the same defect bulk review had before it was windowed.
 * Returns null for a row index the list does not contain.
 */
export function rowOffset<T>(
  groups: { label: string; rows: T[] }[],
  rowIndex: number,
  rowHeight: number,
  headerHeight: number,
): number | null {
  let offset = 0;
  let seen = 0;

  for (const group of groups) {
    if (group.rows.length === 0) continue;
    offset += headerHeight;
    if (rowIndex < seen + group.rows.length) {
      return offset + (rowIndex - seen) * rowHeight;
    }
    offset += group.rows.length * rowHeight;
    seen += group.rows.length;
  }

  return null;
}
