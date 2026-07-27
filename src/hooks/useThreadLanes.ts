import { useMemo } from 'react';
import type { Thread } from '../types';
import { LANES, type Lane, type LaneAssignment } from '../data/lanes';
import { assignLane, useLanes, type LaneFilter } from '../store/lanes';
import { useMail } from '../store/mail';

export interface LaneView {
  /** Whether the chips render at all. */
  enabled: boolean;
  selected: LaneFilter;
  /** The threads the selected lane holds — every thread when `all`. */
  threads: Thread[];
  /** Per lane, how many of `all` landed there. Zero-count lanes get no chip. */
  counts: Record<Lane, number>;
  /** Unread per lane, which is the number worth putting on a chip. */
  unread: Record<Lane, number>;
  /** Every thread's verdict, for the row badge and the correction menu. */
  laneOf: (threadId: string) => LaneAssignment | undefined;
}

const EMPTY: Record<Lane, number> = {
  people: 0,
  newsletters: 0,
  promotions: 0,
  receipts: 0,
  notifications: 0,
};

/**
 * Lanes over one place's listing.
 *
 * Every count is computed over the whole listing rather than the filtered view,
 * so the chips do not change as you click between them. A lane holding nothing
 * shows no chip: five permanent tabs, three of them always empty, is the part
 * of Gmail's version people actually dislike.
 */
export function useThreadLanes(threads: Thread[], place: 'inbox' | 'archive'): LaneView {
  const enabled = useLanes((s) => s.enabled);
  const selected = useLanes((s) => s.selected);
  const overrides = useLanes((s) => s.overrides);
  const assisted = useLanes((s) => s.assisted);
  const approved = useMail((s) => s.approved);

  /*
   * "Have I ever written to this address" — the strongest people signal there
   * is, and one no single thread carries. §2.3's own sender records already
   * hold the count, from the sent-mail walk during setup.
   */
  const replied = useMemo(() => {
    const set = new Set<string>();
    for (const sender of approved) {
      if ((sender.replyCount ?? 0) > 0) set.add(sender.email.toLowerCase());
    }
    return set;
  }, [approved]);

  const assignments = useMemo(() => {
    // Archive is a place you search, not a place you triage. Classifying it
    // costs a pass over every thread in it and buys nothing.
    if (!enabled || place !== 'inbox') return new Map<string, LaneAssignment>();
    const hasReplied = (email: string) => replied.has(email.toLowerCase());
    const map = new Map<string, LaneAssignment>();
    for (const thread of threads) {
      map.set(thread.id, assignLane(thread, hasReplied, overrides, assisted));
    }
    return map;
  }, [threads, replied, overrides, assisted, enabled, place]);

  const counts = useMemo(() => {
    const next = { ...EMPTY };
    const unread = { ...EMPTY };
    for (const thread of threads) {
      const lane = assignments.get(thread.id)?.lane;
      if (!lane) continue;
      next[lane] += 1;
      if (thread.unread) unread[lane] += 1;
    }
    return { counts: next, unread };
  }, [threads, assignments]);

  const filtered = useMemo(() => {
    if (!enabled || selected === 'all') return threads;
    return threads.filter((t) => assignments.get(t.id)?.lane === selected);
  }, [threads, assignments, selected, enabled]);

  /*
   * A lane the listing no longer holds anything for would leave the user
   * staring at an empty column with no way back that isn't a chip that just
   * vanished. Fall back to the whole list rather than to nothing.
   */
  const live: LaneFilter =
    selected !== 'all' && counts.counts[selected as Lane] === 0 ? 'all' : selected;

  return {
    enabled: enabled && place === 'inbox',
    selected: live,
    threads: live === selected ? filtered : threads,
    counts: counts.counts,
    unread: counts.unread,
    laneOf: (id: string) => assignments.get(id),
  };
}

/** The lanes that have anything in them, in rail order. */
export function occupiedLanes(counts: Record<Lane, number>): Lane[] {
  return LANES.filter((lane) => counts[lane] > 0);
}
