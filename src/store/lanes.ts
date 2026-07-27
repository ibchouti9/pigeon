import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Thread } from '../types';
import {
  classify,
  isGuess,
  type Lane,
  type LaneAssignment,
  threadSender,
  threadSignals,
} from '../data/lanes';

/** `all` is the column Pigeon showed before lanes existed. */
export type LaneFilter = Lane | 'all';

interface LaneState {
  /**
   * Off by default is wrong and on-by-default-forever is worse. Lanes start on,
   * and turning them off has to restore the old column exactly — one list, no
   * chips, nothing hidden.
   */
  enabled: boolean;
  selected: LaneFilter;

  /**
   * A correction, keyed by sender address rather than by thread. "This is a
   * newsletter" is almost never a statement about one email; it is a statement
   * about who sent it, and a per-thread override would make the user say it
   * again next week. Survives reloads, outranks everything.
   */
  overrides: Record<string, Lane>;

  /**
   * What the assistant decided, keyed by thread. Only ever written for threads
   * the rules were unsure of, and never for a sender the user has corrected.
   */
  assisted: Record<string, { lane: Lane; why: string }>;

  setEnabled: (v: boolean) => void;
  select: (lane: LaneFilter) => void;
  /** Records a correction and forgets any assistant verdict it contradicts. */
  correct: (email: string, lane: Lane) => void;
  clearCorrection: (email: string) => void;
  recordAssisted: (threadId: string, lane: Lane, why: string) => void;
}

export const useLanes = create<LaneState>()(
  persist(
    (set) => ({
      enabled: true,
      selected: 'all',
      overrides: {},
      assisted: {},

      setEnabled: (enabled) => set((s) => ({ enabled, selected: enabled ? s.selected : 'all' })),
      select: (selected) => set({ selected }),

      correct: (email, lane) =>
        set((s) => ({ overrides: { ...s.overrides, [email.toLowerCase()]: lane } })),

      clearCorrection: (email) =>
        set((s) => {
          const overrides = { ...s.overrides };
          delete overrides[email.toLowerCase()];
          return { overrides };
        }),

      recordAssisted: (threadId, lane, why) =>
        set((s) => ({ assisted: { ...s.assisted, [threadId]: { lane, why } } })),
    }),
    {
      name: 'pigeon.lanes',
      // `selected` is a view, not a preference: landing back in Offers three
      // days later, with the rest of your mail apparently gone, is a bug that
      // looks exactly like lost mail.
      partialize: (s) => ({ enabled: s.enabled, overrides: s.overrides, assisted: s.assisted }),
    },
  ),
);

/**
 * The one place precedence is decided, so every caller agrees.
 *
 * The user outranks the assistant outranks the rules, and the rules outrank the
 * assistant whenever they were already sure — a model is asked about the hard
 * ones, and is not invited to relitigate a `List-Unsubscribe` header.
 */
export function assignLane(
  thread: Thread,
  hasReplied: (email: string) => boolean,
  overrides: Record<string, Lane>,
  assisted: Record<string, { lane: Lane; why: string }>,
): LaneAssignment {
  const sender = threadSender(thread).email.toLowerCase();

  const override = overrides[sender];
  if (override) {
    return { lane: override, confidence: 1, why: 'You put this sender here', source: 'user' };
  }

  const verdict = classify(threadSignals(thread, hasReplied));

  const help = assisted[thread.id];
  if (help && isGuess(verdict)) {
    return {
      lane: help.lane,
      confidence: 0.75,
      // A model that gave no reason worth showing still gave a verdict. Say
      // where it came from rather than dressing up the rules' reason as the
      // model's, which would attribute an argument to something that never
      // made it.
      why: help.why || 'Your model read this one',
      source: 'assistant',
    };
  }

  return { ...verdict, source: 'rules' };
}
