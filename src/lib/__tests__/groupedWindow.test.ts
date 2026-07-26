import { describe, expect, it } from 'vitest';
import { flattenGroups, groupedWindow, rowOffset } from '../groupedWindow';

/**
 * §5.5's thread list is 56px rows under sticky 32px date headers, and it
 * rendered every one of them. At the 2,000-thread ceiling the Gmail walk now
 * uses, that measured 43,411 DOM nodes and a 299ms lag on a single `j` — worse
 * than any animation in the product, on the most-used key in it.
 *
 * The arithmetic is tested here rather than through the component because this
 * is where windowing goes wrong, and the edges — an empty group, a scroll
 * position past the end, a viewport taller than the list — are exactly the ones
 * a rendering test cannot reach.
 */

const ROW = 56;
const HEADER = 32;

function groups(...sizes: number[]) {
  return sizes.map((n, g) => ({
    label: `GROUP ${g}`,
    rows: Array.from({ length: n }, (_, i) => `g${g}-r${i}`),
  }));
}

function windowAt(scrollTop: number, viewportHeight = 560, sizes = [3, 40, 5]) {
  return groupedWindow({
    groups: groups(...sizes),
    scrollTop,
    viewportHeight,
    rowHeight: ROW,
    headerHeight: HEADER,
    overscan: 2,
  });
}

describe('flattenGroups', () => {
  it('puts a header before each group and numbers the rows across all of them', () => {
    const items = flattenGroups(groups(2, 1));

    expect(items.map((i) => i.kind)).toEqual(['header', 'row', 'row', 'header', 'row']);
    expect(items.filter((i) => i.kind === 'row').map((i) => i.rowIndex)).toEqual([0, 1, 2]);
  });

  it('drops a group with no rows rather than heading nothing', () => {
    const items = flattenGroups([
      { label: 'TODAY', rows: ['a'] },
      { label: 'EMPTY', rows: [] },
    ]);
    expect(items.map((i) => i.label)).toEqual(['TODAY', 'TODAY']);
  });

  it('carries each row’s group label, so a row knows where it sits', () => {
    const items = flattenGroups(groups(1, 1));
    const rows = items.filter((i) => i.kind === 'row');
    expect(rows.map((r) => r.label)).toEqual(['GROUP 0', 'GROUP 1']);
  });
});

describe('groupedWindow', () => {
  it('renders far fewer items than the list holds', () => {
    const { items } = windowAt(0, 560, [3, 400, 5]);
    // A 560px viewport plus overscan, not 408 rows and 3 headers.
    expect(items.length).toBeLessThan(30);
  });

  it('pads to the full height so the scrollbar tells the truth', () => {
    const sizes = [3, 40, 5];
    const rows = sizes.reduce((a, b) => a + b, 0);
    const expected = rows * ROW + sizes.length * HEADER;

    const { topPad, bottomPad, items, totalHeight } = windowAt(0, 560, sizes);
    const rendered = items.reduce((sum, i) => sum + (i.kind === 'header' ? HEADER : ROW), 0);

    expect(totalHeight).toBe(expected);
    expect(topPad + rendered + bottomPad).toBe(expected);
  });

  it('adds up at every scroll position, not just the top', () => {
    const sizes = [3, 40, 5];
    for (let scrollTop = 0; scrollTop < 3000; scrollTop += 137) {
      const { topPad, bottomPad, items, totalHeight } = windowAt(scrollTop, 560, sizes);
      const rendered = items.reduce((sum, i) => sum + (i.kind === 'header' ? HEADER : ROW), 0);
      expect(topPad + rendered + bottomPad, `at ${scrollTop}`).toBe(totalHeight);
    }
  });

  it('slides the window down as it scrolls', () => {
    const first = windowAt(0).items.find((i) => i.kind === 'row')?.rowIndex ?? -1;
    const later = windowAt(1400).items.find((i) => i.kind === 'row')?.rowIndex ?? -1;
    expect(later).toBeGreaterThan(first);
  });

  it('renders rows rather than blank space when the list shrinks underneath it', () => {
    // Scrolled deep into a long list, which then becomes a short one.
    const { items, topPad } = windowAt(5000, 560, [2]);
    expect(items.some((i) => i.kind === 'row')).toBe(true);
    expect(topPad).toBeLessThanOrEqual(2 * ROW + HEADER);
  });

  it('ignores a negative scroll position', () => {
    expect(windowAt(-500).items[0]?.kind).toBe('header');
  });

  it('renders everything when the viewport is taller than the list', () => {
    const { items, topPad, bottomPad } = windowAt(0, 4000, [2, 2]);
    expect(items.filter((i) => i.kind === 'row')).toHaveLength(4);
    expect(topPad).toBe(0);
    expect(bottomPad).toBe(0);
  });

  it('returns an empty window for an empty list', () => {
    const { items, totalHeight } = groupedWindow({
      groups: [],
      scrollTop: 0,
      viewportHeight: 560,
      rowHeight: ROW,
      headerHeight: HEADER,
      overscan: 2,
    });
    expect(items).toEqual([]);
    expect(totalHeight).toBe(0);
  });

  it('keeps a row’s cursor index stable however it is scrolled', () => {
    const target = 30;
    for (const scrollTop of [0, 800, 1600, 2400]) {
      const found = windowAt(scrollTop, 560, [3, 40, 5]).items.find(
        (i) => i.kind === 'row' && i.rowIndex === target,
      );
      if (found) expect(found.value).toBe('g1-r27');
    }
  });
});

describe('rowOffset', () => {
  it('counts the headers above a row, not just the rows', () => {
    // Group 0 has 3 rows; row 3 is the first of group 1, under two headers.
    expect(rowOffset(groups(3, 40), 3, ROW, HEADER)).toBe(HEADER + 3 * ROW + HEADER);
  });

  it('puts the first row directly under the first header', () => {
    expect(rowOffset(groups(2, 2), 0, ROW, HEADER)).toBe(HEADER);
  });

  it('agrees with the window it is used to scroll to', () => {
    const sizes = [3, 40, 5];
    const target = 25;
    const offset = rowOffset(groups(...sizes), target, ROW, HEADER)!;

    // Scroll so the row sits at the top; it must be in the rendered slice.
    const { items } = windowAt(offset, 560, sizes);
    expect(items.some((i) => i.kind === 'row' && i.rowIndex === target)).toBe(true);
  });

  it('skips a group with no rows, as the flattening does', () => {
    const withEmpty = [
      { label: 'A', rows: ['a'] },
      { label: 'EMPTY', rows: [] as string[] },
      { label: 'B', rows: ['b'] },
    ];
    expect(rowOffset(withEmpty, 1, ROW, HEADER)).toBe(HEADER + ROW + HEADER);
  });

  it('returns null for a row the list does not have', () => {
    expect(rowOffset(groups(2), 99, ROW, HEADER)).toBeNull();
  });
});
