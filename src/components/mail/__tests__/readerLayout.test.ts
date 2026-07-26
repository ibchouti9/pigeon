import { describe, expect, it } from 'vitest';
import { defaultCollapse, firstExpandedId, readerStartOffset } from '../readerLayout';
import type { Message } from '../../../types';

/**
 * Driving a forty-message thread showed the reader opening on a wall of
 * collapsed one-liners: §5.6's rule collapses the first thirty-four, which is
 * 1,088px of history above the first thing anyone opened the thread to read.
 * The spec fixes which messages collapse but not where the pane starts — its
 * own example thread has four messages, so the question never comes up.
 */

function messages(pattern: ('user' | 'them')[]): Message[] {
  return pattern.map((who, i) => ({
    id: `m${i}`,
    threadId: 't',
    from:
      who === 'user'
        ? { name: 'Marc Ferrum', email: 'marc@ferrum.dev' }
        : { name: 'Dana Whitlock', email: 'dana@lumen.com' },
    to: [],
    cc: [],
    subject: 'Re: Q3 invoice',
    body: 'Body.',
    date: `2026-07-${String(i + 1).padStart(2, '0')}T09:00:00.000Z`,
    isFromUser: who === 'user',
    attachments: [],
  }));
}

const them = (n: number) => messages(Array.from({ length: n }, () => 'them' as const));

describe('defaultCollapse', () => {
  it('expands a short thread entirely', () => {
    expect(defaultCollapse(them(4)).size).toBe(0);
  });

  it('collapses everything beyond the 8 most recent', () => {
    const collapsed = defaultCollapse(them(40));
    expect(collapsed.size).toBe(32);
    expect(collapsed.has('m31')).toBe(true);
    expect(collapsed.has('m32')).toBe(false);
  });

  it('collapses a message the user sent that has a later one after it', () => {
    const collapsed = defaultCollapse(messages(['user', 'them', 'user']));
    expect(collapsed.has('m0')).toBe(true);
    // The last message is the user's own, but nothing follows it.
    expect(collapsed.has('m2')).toBe(false);
  });
});

describe('firstExpandedId', () => {
  it('finds where reading starts in a long thread', () => {
    const all = them(40);
    expect(firstExpandedId(all, defaultCollapse(all))).toBe('m32');
  });

  it('is the first message when nothing is collapsed', () => {
    const all = them(3);
    expect(firstExpandedId(all, defaultCollapse(all))).toBe('m0');
  });

  it('returns null for a thread with no messages', () => {
    expect(firstExpandedId([], new Set())).toBeNull();
  });

  it('skips a run of collapsed messages at the head', () => {
    // Forty messages the user sent alternating with replies: the run of
    // collapsed history is not uniform, and the first expanded one is what
    // matters, not the count.
    const all = messages(Array.from({ length: 40 }, (_, i) => (i % 2 ? 'user' : 'them')));
    const collapsed = defaultCollapse(all);
    const id = firstExpandedId(all, collapsed);
    expect(collapsed.has(id!)).toBe(false);
    expect(all.findIndex((m) => m.id === id)).toBe(32);
  });
});

describe('readerStartOffset', () => {
  const BODY_TOP = 100;
  const BODY_HEIGHT = 800;

  it('leaves a short thread at the top, where §5.6 puts the summary', () => {
    // The first expanded message sits 120px down — the summary block above it.
    expect(readerStartOffset(BODY_TOP + 120, BODY_TOP, BODY_HEIGHT)).toBeNull();
  });

  it('scrolls when the collapsed history pushes reading off screen', () => {
    // 34 collapsed rows at 32px, plus the summary block.
    const offset = readerStartOffset(BODY_TOP + 1200, BODY_TOP, BODY_HEIGHT);
    expect(offset).toBe(1200 - 32);
  });

  it('leaves one collapsed row showing, so the history above is visible', () => {
    const offset = readerStartOffset(BODY_TOP + 1200, BODY_TOP, BODY_HEIGHT)!;
    expect(1200 - offset).toBe(32);
  });

  it('does nothing when the target is already above the fold', () => {
    // Mid-scroll, the pane is already past it — scrolling back would fight the
    // user.
    expect(readerStartOffset(BODY_TOP - 400, BODY_TOP, BODY_HEIGHT)).toBeNull();
  });

  it('does nothing when the target is exactly at the top', () => {
    expect(readerStartOffset(BODY_TOP, BODY_TOP, BODY_HEIGHT)).toBeNull();
  });

  it('scrolls rather than leaving reading just off the bottom edge', () => {
    // Right at the fold: visible only as a sliver is not visible.
    expect(readerStartOffset(BODY_TOP + BODY_HEIGHT - 8, BODY_TOP, BODY_HEIGHT)).not.toBeNull();
  });

  it('never scrolls the target out of view at the other end', () => {
    for (const distance of [200, 705, 800, 1200, 5000]) {
      const offset = readerStartOffset(BODY_TOP + distance, BODY_TOP, BODY_HEIGHT);
      if (offset === null) continue;
      const after = distance - offset;
      expect(after, `at ${distance}`).toBeGreaterThanOrEqual(0);
      expect(after, `at ${distance}`).toBeLessThan(BODY_HEIGHT);
    }
  });
});
