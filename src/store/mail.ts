import { create } from 'zustand';
import type { Account, Address, HeldSender, Sender, Thread } from '../types';
import type { MailProvider, SearchResults } from '../data/provider';
import { MailError } from '../data/provider';
import { MockMailProvider } from '../data/mock/mockProvider';
import { toast } from './toast';
import { displayName, plural } from '../lib/format';

export type LoadStatus = 'idle' | 'loading' | 'ready' | 'error';

interface MailState {
  provider: MailProvider;
  account: Account | null;

  inbox: Thread[];
  archive: Thread[];
  held: HeldSender[];
  approved: Sender[];
  declined: Sender[];
  contacts: Address[];

  status: Record<'account' | 'inbox' | 'archive' | 'held' | 'senders', LoadStatus>;
  /**
   * Bumped whenever the provider is swapped. A load started against the old
   * provider must not apply its result afterwards — signing out of Gmail back
   * to the demo account, or switching scenarios in the dev harness, otherwise
   * lets the previous account's mail land in the new one's screens.
   */
  providerEpoch: number;
  /** Set when Google revoked access — locks the shell (§5.5). */
  revoked: boolean;

  setProvider: (p: MailProvider) => void;
  loadAccount: () => Promise<void>;
  loadThreads: (place: 'inbox' | 'archive') => Promise<void>;
  loadHeld: () => Promise<void>;
  loadSenders: () => Promise<void>;
  loadContacts: () => Promise<void>;

  markRead: (threadId: string) => Promise<void>;
  setPlace: (threadId: string, place: 'inbox' | 'archive') => Promise<void>;

  /** One move, one toast, one undo — however many threads were selected. */
  setPlaceMany: (threadIds: string[], place: 'inbox' | 'archive') => Promise<void>;

  decide: (senderId: string, decision: 'approved' | 'declined') => Promise<boolean>;
  decideMany: (
    senderIds: string[],
    decision: 'approved' | 'declined',
  ) => Promise<{ ok: string[]; failed: string[] }>;

  /**
   * How many sender decisions are in flight. Both decide paths remove their
   * rows optimistically, so `held` reads zero for the whole round-trip even
   * when some of them are about to roll back. Anything that reacts to an empty
   * Screener — the empty state, the jump back to Stack — has to wait for this
   * to reach zero, or it tears the list down mid-action.
   */
  deciding: number;

  /**
   * The sender an undo just brought back, so §3.2 3c can put its card on top
   * of the stack again. `listHeld` re-sorts by date, so without this the card
   * reappeared wherever its newest message happened to fall.
   */
  restoredSenderId: string | null;
  reverse: (senderId: string, to: 'approved' | 'declined') => Promise<boolean>;

  search: (query: string, includeHeld: boolean) => Promise<SearchResults>;
}

function threadsFor(state: MailState, place: 'inbox' | 'archive'): Thread[] {
  return place === 'inbox' ? state.inbox : state.archive;
}

/**
 * Moves one thread between places in local state. Returns false when the thread
 * isn't where it was expected, which is how both callers decide there is
 * nothing to send to the provider.
 */
function moveLocally(
  set: (partial: Partial<MailState>) => void,
  get: () => MailState,
  threadId: string,
  place: 'inbox' | 'archive',
): boolean {
  const from = place === 'inbox' ? 'archive' : 'inbox';
  const source = threadsFor(get(), from);
  const thread = source.find((t) => t.id === threadId);
  if (!thread) return false;

  set({
    [from]: source.filter((t) => t.id !== threadId),
    [place]: [{ ...thread, place }, ...threadsFor(get(), place)].sort((a, b) =>
      b.lastMessageAt.localeCompare(a.lastMessageAt),
    ),
  } as Partial<MailState>);
  return true;
}

/**
 * §5.5 — a revoked token is its own state, not a connection error. It locks the
 * shell and offers "Connect Gmail" rather than "Try again", because retrying
 * cannot possibly work. Every load has to recognise it; a caught error that
 * loses its code degrades this into the generic unreachable message.
 */
function isRevoked(error: unknown): boolean {
  return error instanceof MailError && error.code === 'revoked';
}

export const useMail = create<MailState>((set, get) => ({
  provider: new MockMailProvider(),
  account: null,

  inbox: [],
  archive: [],
  held: [],
  approved: [],
  declined: [],
  contacts: [],

  status: {
    account: 'idle',
    inbox: 'idle',
    archive: 'idle',
    held: 'idle',
    senders: 'idle',
  },
  revoked: false,
  providerEpoch: 0,
  deciding: 0,
  restoredSenderId: null,

  setProvider: (provider) =>
    set((s) => ({
      provider,
      providerEpoch: s.providerEpoch + 1,
      account: null,
      inbox: [],
      archive: [],
      held: [],
      approved: [],
      declined: [],
      contacts: [],
      status: {
        account: 'idle',
        inbox: 'idle',
        archive: 'idle',
        held: 'idle',
        senders: 'idle',
      },
      revoked: false,
    })),

  loadAccount: async () => {
    const epoch = get().providerEpoch;
    set((s) => ({ status: { ...s.status, account: 'loading' } }));
    try {
      const account = await get().provider.getAccount();
      if (get().providerEpoch !== epoch) return;
      set((s) => ({ account, status: { ...s.status, account: 'ready' } }));
    } catch (error) {
      if (get().providerEpoch !== epoch) return;
      set((s) => ({
        status: { ...s.status, account: 'error' },
        revoked: s.revoked || isRevoked(error),
      }));
    }
  },

  loadThreads: async (place) => {
    const epoch = get().providerEpoch;
    set((s) => ({ status: { ...s.status, [place]: 'loading' } }));
    try {
      /*
       * Each page as it lands, not just the finished walk. A real mailbox holds
       * thousands of threads and every body is its own request, so waiting for
       * all of them leaves the screen on a skeleton for minutes — the Inbox has
       * §5.2b's progress bar behind it during onboarding, but the Archive is
       * walked the first time someone clicks it, with nothing to look at.
       */
      const publish = (threads: Thread[]) => {
        if (get().providerEpoch !== epoch) return;
        set((s) => ({
          [place]: threads,
          status: { ...s.status, [place]: 'ready' },
        }) as Partial<MailState>);
      };

      const threads = await get().provider.listThreads(place, publish);
      if (get().providerEpoch !== epoch) return;
      publish(threads);
    } catch (error) {
      if (get().providerEpoch !== epoch) return;
      set((s) => ({
        status: { ...s.status, [place]: 'error' },
        revoked: s.revoked || isRevoked(error),
      }));
    }
  },

  loadHeld: async () => {
    const epoch = get().providerEpoch;
    set((s) => ({ status: { ...s.status, held: 'loading' } }));
    try {
      const held = await get().provider.listHeld();
      if (get().providerEpoch !== epoch) return;
      set((s) => ({ held, status: { ...s.status, held: 'ready' } }));
    } catch (error) {
      if (get().providerEpoch !== epoch) return;
      set((s) => ({
        status: { ...s.status, held: 'error' },
        revoked: s.revoked || isRevoked(error),
      }));
    }
  },

  loadSenders: async () => {
    const epoch = get().providerEpoch;
    set((s) => ({ status: { ...s.status, senders: 'loading' } }));
    try {
      const [approved, declined] = await Promise.all([
        get().provider.listSenders('approved'),
        get().provider.listSenders('declined'),
      ]);
      if (get().providerEpoch !== epoch) return;
      set((s) => ({ approved, declined, status: { ...s.status, senders: 'ready' } }));
    } catch (error) {
      if (get().providerEpoch !== epoch) return;
      set((s) => ({
        status: { ...s.status, senders: 'error' },
        revoked: s.revoked || isRevoked(error),
      }));
    }
  },

  loadContacts: async () => {
    const epoch = get().providerEpoch;
    try {
      const contacts = await get().provider.listContacts();
      if (get().providerEpoch !== epoch) return;
      set({ contacts });
    } catch {
      if (get().providerEpoch !== epoch) return;
      set({ contacts: [] });
    }
  },

  markRead: async (threadId) => {
    const epoch = get().providerEpoch;
    const before = get().inbox;
    if (!before.some((t) => t.id === threadId && t.unread)) return;
    set({ inbox: before.map((t) => (t.id === threadId ? { ...t, unread: false } : t)) });
    try {
      await get().provider.markRead(threadId, true);
    } catch {
      // Rolling back after a provider swap would restore the previous
      // account's inbox over the new one's.
      if (get().providerEpoch !== epoch) return;
      set({ inbox: before });
    }
  },

  setPlace: async (threadId, place) => {
    const from = place === 'inbox' ? 'archive' : 'inbox';
    const epoch = get().providerEpoch;
    const snapshot = { inbox: get().inbox, archive: get().archive };
    if (!moveLocally(set, get, threadId, place)) return;

    try {
      await get().provider.setPlace(threadId, place);
      toast.undo(
        place === 'archive' ? 'Archived.' : 'Moved to inbox.',
        'Undo',
        () => void get().setPlace(threadId, from),
      );
    } catch {
      // An optimistic rollback belongs to the provider that started it.
      if (get().providerEpoch !== epoch) return;
      set(snapshot);
      toast.error(
        place === 'archive'
          ? "Couldn't archive this thread. Check your connection and try again."
          : "Couldn't move this thread. Check your connection and try again.",
        { label: 'Try again', run: () => void get().setPlace(threadId, place) },
      );
    }
  },

  setPlaceMany: async (threadIds, place) => {
    if (threadIds.length === 0) return;
    if (threadIds.length === 1) return get().setPlace(threadIds[0], place);

    const from = place === 'inbox' ? 'archive' : 'inbox';
    const epoch = get().providerEpoch;

    const moved = threadIds.filter((id) => moveLocally(set, get, id, place));
    if (moved.length === 0) return;

    const ok: string[] = [];
    const failed: string[] = [];
    for (const id of moved) {
      try {
        await get().provider.setPlace(id, place);
        ok.push(id);
      } catch {
        failed.push(id);
      }
    }

    if (get().providerEpoch !== epoch) return;

    if (failed.length === 0) {
      // §7.5 gives no bulk-archive row; this follows the shape of its bulk
      // sender lines. One toast, one undo — a toast per thread meant the
      // fourth pushed the first out of view with its undo still unused.
      toast.undo(
        place === 'archive'
          ? `Archived ${plural(ok.length, 'thread')}.`
          : `Moved ${plural(ok.length, 'thread')} to your inbox.`,
        'Undo all',
        () => void get().setPlaceMany(ok, from),
      );
      return;
    }

    // Put back only the ones that didn't make it.
    await get().loadThreads('inbox');
    await get().loadThreads('archive');
    toast.error(
      place === 'archive'
        ? `Archived ${ok.length} of ${moved.length} threads. ${failed.length} didn't go through — try those again.`
        : `Moved ${ok.length} of ${moved.length} threads. ${failed.length} didn't go through — try those again.`,
      { label: 'Try again', run: () => void get().setPlaceMany(failed, place) },
    );
  },

  decide: async (senderId, decision) => {
    const epoch = get().providerEpoch;
    const held = get().held;
    const entry = held.find((h) => h.sender.id === senderId);
    if (!entry) return false;

    // Optimistic: the card leaves immediately (§3.2 step 3).
    set((st) => ({
      held: held.filter((h) => h.sender.id !== senderId),
      deciding: st.deciding + 1,
    }));

    try {
      await get().provider.decideSender(senderId, decision);
      await Promise.all([get().loadThreads('inbox'), get().loadSenders()]);

      const who =
        decision === 'approved'
          ? displayName(entry.sender)
          : entry.sender.email;
      toast.undo(
        decision === 'approved'
          ? `Approved ${who}. Their mail is in your inbox.`
          : `Declined ${who}. You won't see their mail.`,
        'Undo',
        async () => {
          await get().provider.undecideSender(senderId);
          await Promise.all([get().loadHeld(), get().loadThreads('inbox'), get().loadSenders()]);
          set({ restoredSenderId: senderId });
          toast.confirm('Decision undone.');
        },
      );
      return true;
    } catch {
      // §3.2 3d — roll back before the toast appears; never leave the card gone.
      // Unless the provider changed underneath, in which case these belong to
      // another account.
      if (get().providerEpoch !== epoch) return false;
      set({ held });
      toast.error(
        `Couldn't ${decision === 'approved' ? 'approve' : 'decline'} ${displayName(entry.sender)}. Check your connection and try again.`,
        { label: 'Try again', run: () => void get().decide(senderId, decision) },
      );
      return false;
    } finally {
      set((st) => ({ deciding: Math.max(0, st.deciding - 1) }));
    }
  },

  decideMany: async (senderIds, decision) => {
    const held = get().held;
    const epoch = get().providerEpoch;
    const wanted = new Set(senderIds);
    set((st) => ({
      held: held.filter((h) => !wanted.has(h.sender.id)),
      deciding: st.deciding + 1,
    }));

    try {
      return await decideAll();
    } finally {
      set((st) => ({ deciding: Math.max(0, st.deciding - 1) }));
    }

    async function decideAll() {
      const ok: string[] = [];
      const failed: string[] = [];
      // Pinned, not re-read each iteration: a provider swap mid-batch would
      // otherwise split the decisions across two accounts.
      const provider = get().provider;
      for (const id of senderIds) {
        try {
          await provider.decideSender(id, decision);
          ok.push(id);
        } catch {
          failed.push(id);
        }
      }

      // These belong to the account that started the batch.
      if (get().providerEpoch !== epoch) return { ok, failed };

      await Promise.all([get().loadHeld(), get().loadThreads('inbox'), get().loadSenders()]);

      const verb = decision === 'approved' ? 'Approved' : 'Declined';
      if (failed.length === 0) {
        toast.undo(
          decision === 'approved'
            ? `${verb} ${plural(ok.length, 'sender')}. Their mail is in your inbox.`
            : `${verb} ${plural(ok.length, 'sender')}. You won't see their mail.`,
          'Undo all',
          async () => {
            for (const id of ok) await get().provider.undecideSender(id);
            await Promise.all([
              get().loadHeld(),
              get().loadThreads('inbox'),
              get().loadSenders(),
            ]);
            toast.confirm('Decision undone.');
          },
        );
      } else {
        // §3.3 3b — partial failure names the counts and retries only what failed.
        toast.error(
          `${verb} ${ok.length} of ${senderIds.length} senders. ${failed.length} didn't go through — try those again.`,
          { label: 'Try again', run: () => void get().decideMany(failed, decision) },
        );
      }

      return { ok, failed };
    }
  },

  reverse: async (senderId, to) => {
    const from = to === 'approved' ? 'declined' : 'approved';
    const list = to === 'approved' ? get().declined : get().approved;
    const sender = list.find((s) => s.id === senderId);
    if (!sender) return false;

    const epoch = get().providerEpoch;
    const snapshot = { approved: get().approved, declined: get().declined };
    set({
      [from]: list.filter((s) => s.id !== senderId),
      [to]: [
        { ...sender, status: to, decidedAt: new Date().toISOString() },
        ...(to === 'approved' ? get().approved : get().declined),
      ],
    } as Partial<MailState>);

    try {
      await get().provider.decideSender(senderId, to);
      await get().loadSenders();
      toast.undo(
        to === 'declined'
          ? `Declined ${displayName(sender)}. Their mail stays in your inbox; new mail stops.`
          : `Approved ${sender.email}. Their next message goes to your inbox.`,
        'Undo',
        async () => {
          await get().provider.decideSender(senderId, from);
          await get().loadSenders();
          toast.confirm('Decision undone.');
        },
      );
      return true;
    } catch {
      if (get().providerEpoch !== epoch) return false;
      set(snapshot);
      toast.error(
        `Couldn't change ${displayName(sender)}. Check your connection and try again.`,
        { label: 'Try again', run: () => void get().reverse(senderId, to) },
      );
      return false;
    }
  },

  search: (query, includeHeld) => get().provider.search(query, includeHeld),
}));

/** Unread thread count — the only count the Inbox shows (§2.1). */
export function useUnreadCount(): number {
  return useMail((s) => s.inbox.reduce((n, t) => n + (t.unread ? 1 : 0), 0));
}

/** Held-sender count for the Screener badge — senders, not messages (§2.1). */
export function useHeldCount(): number {
  return useMail((s) => s.held.length);
}
