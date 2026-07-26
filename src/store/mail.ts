import { create } from 'zustand';
import type { Account, Address, HeldSender, Sender, Thread } from '../types';
import type { MailProvider, SearchResults } from '../data/provider';
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

  decide: (senderId: string, decision: 'approved' | 'declined') => Promise<boolean>;
  decideMany: (
    senderIds: string[],
    decision: 'approved' | 'declined',
  ) => Promise<{ ok: string[]; failed: string[] }>;
  reverse: (senderId: string, to: 'approved' | 'declined') => Promise<boolean>;

  search: (query: string, includeHeld: boolean) => Promise<SearchResults>;
}

function threadsFor(state: MailState, place: 'inbox' | 'archive'): Thread[] {
  return place === 'inbox' ? state.inbox : state.archive;
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
    } catch {
      if (get().providerEpoch !== epoch) return;
      set((s) => ({ status: { ...s.status, account: 'error' } }));
    }
  },

  loadThreads: async (place) => {
    const epoch = get().providerEpoch;
    set((s) => ({ status: { ...s.status, [place]: 'loading' } }));
    try {
      const threads = await get().provider.listThreads(place);
      if (get().providerEpoch !== epoch) return;
      set((s) => ({
        [place]: threads,
        status: { ...s.status, [place]: 'ready' },
      }) as Partial<MailState>);
    } catch {
      if (get().providerEpoch !== epoch) return;
      set((s) => ({ status: { ...s.status, [place]: 'error' } }));
    }
  },

  loadHeld: async () => {
    const epoch = get().providerEpoch;
    set((s) => ({ status: { ...s.status, held: 'loading' } }));
    try {
      const held = await get().provider.listHeld();
      if (get().providerEpoch !== epoch) return;
      set((s) => ({ held, status: { ...s.status, held: 'ready' } }));
    } catch {
      if (get().providerEpoch !== epoch) return;
      set((s) => ({ status: { ...s.status, held: 'error' } }));
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
    } catch {
      if (get().providerEpoch !== epoch) return;
      set((s) => ({ status: { ...s.status, senders: 'error' } }));
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
    const before = get().inbox;
    if (!before.some((t) => t.id === threadId && t.unread)) return;
    set({ inbox: before.map((t) => (t.id === threadId ? { ...t, unread: false } : t)) });
    try {
      await get().provider.markRead(threadId, true);
    } catch {
      set({ inbox: before });
    }
  },

  setPlace: async (threadId, place) => {
    const from = place === 'inbox' ? 'archive' : 'inbox';
    const source = threadsFor(get(), from);
    const thread = source.find((t) => t.id === threadId);
    if (!thread) return;

    const snapshot = { inbox: get().inbox, archive: get().archive };
    const moved = { ...thread, place };
    set({
      [from]: source.filter((t) => t.id !== threadId),
      [place]: [moved, ...threadsFor(get(), place)].sort((a, b) =>
        b.lastMessageAt.localeCompare(a.lastMessageAt),
      ),
    } as Partial<MailState>);

    try {
      await get().provider.setPlace(threadId, place);
      toast.undo(
        place === 'archive' ? 'Archived.' : 'Moved to inbox.',
        'Undo',
        () => void get().setPlace(threadId, from),
      );
    } catch {
      set(snapshot);
      toast.error(
        place === 'archive'
          ? "Couldn't archive this thread. Check your connection and try again."
          : "Couldn't move this thread. Check your connection and try again.",
        { label: 'Try again', run: () => void get().setPlace(threadId, place) },
      );
    }
  },

  decide: async (senderId, decision) => {
    const held = get().held;
    const entry = held.find((h) => h.sender.id === senderId);
    if (!entry) return false;

    // Optimistic: the card leaves immediately (§3.2 step 3).
    set({ held: held.filter((h) => h.sender.id !== senderId) });

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
          toast.confirm('Decision undone.');
        },
      );
      return true;
    } catch {
      // §3.2 3d — roll back before the toast appears; never leave the card gone.
      set({ held });
      toast.error(
        `Couldn't ${decision === 'approved' ? 'approve' : 'decline'} ${displayName(entry.sender)}. Check your connection and try again.`,
        { label: 'Try again', run: () => void get().decide(senderId, decision) },
      );
      return false;
    }
  },

  decideMany: async (senderIds, decision) => {
    const held = get().held;
    const wanted = new Set(senderIds);
    set({ held: held.filter((h) => !wanted.has(h.sender.id)) });

    const ok: string[] = [];
    const failed: string[] = [];
    for (const id of senderIds) {
      try {
        await get().provider.decideSender(id, decision);
        ok.push(id);
      } catch {
        failed.push(id);
      }
    }

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
  },

  reverse: async (senderId, to) => {
    const from = to === 'approved' ? 'declined' : 'approved';
    const list = to === 'approved' ? get().declined : get().approved;
    const sender = list.find((s) => s.id === senderId);
    if (!sender) return false;

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
