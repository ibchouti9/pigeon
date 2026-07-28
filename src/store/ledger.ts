import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ObligationKind } from '../ai/types';

/** One thing a conversation still requires of somebody. */
export interface Obligation {
  /** `${threadId}:${what}` — stable across re-reads of an unchanged thread. */
  id: string;
  threadId: string;
  kind: ObligationKind;
  what: string;
  who: string;
  due?: string;
  /** The subject, kept so a ledger row can render without the thread beside it. */
  subject: string;
  /** ISO 8601 of the conversation's newest message, for ordering. */
  at: string;
}

interface LedgerState {
  /** threadId → what that conversation owes. Empty array means "read, owes nothing". */
  found: Record<string, Obligation[]>;
  /**
   * The conversation state each entry was read from — `lastMessageAt` plus the
   * message count. A reply changes both, and is exactly when an obligation may
   * have been discharged, so it is exactly when the read must be thrown away.
   */
  readAt: Record<string, string>;
  /** Obligation ids the user has ticked off. */
  done: string[];

  record: (threadId: string, key: string, obligations: Obligation[]) => void;
  /** Whether this conversation still needs reading, given its current state. */
  needsRead: (threadId: string, key: string) => boolean;
  setDone: (id: string, done: boolean) => void;
  isDone: (id: string) => boolean;
  clear: () => void;
}

/**
 * What the mailbox is asking of the reader, kept between sessions.
 *
 * The reading is expensive — a local model takes a couple of seconds a
 * conversation — and almost all of it is wasted work on the second run, since
 * most threads do not change between one open and the next. So the result is
 * cached against the conversation's own state and only re-read when the
 * conversation moves.
 *
 * `done` is the user's, not the model's: ticking something off is a fact about
 * what they have dealt with, and re-reading the thread must never un-tick it.
 */
export const useLedger = create<LedgerState>()(
  persist(
    (set, get) => ({
      found: {},
      readAt: {},
      done: [],

      record: (threadId, key, obligations) =>
        set((s) => ({
          found: { ...s.found, [threadId]: obligations },
          readAt: { ...s.readAt, [threadId]: key },
        })),

      needsRead: (threadId, key) => get().readAt[threadId] !== key,

      setDone: (id, done) =>
        set((s) => ({
          done: done ? [...new Set([...s.done, id])] : s.done.filter((d) => d !== id),
        })),

      isDone: (id) => get().done.includes(id),

      clear: () => set({ found: {}, readAt: {}, done: [] }),
    }),
    { name: 'pigeon.ledger' },
  ),
);

/** Every obligation the ledger holds, newest conversation first. */
export function allObligations(state: LedgerState): Obligation[] {
  return Object.values(state.found)
    .flat()
    .sort((a, b) => b.at.localeCompare(a.at));
}
