import type {
  Account,
  Address,
  HeldSender,
  Message,
  OutgoingAttachment,
  Sender,
  SyncProgress,
  Thread,
} from '../../types';
import { MailError, type MailProvider, type SearchResults } from '../provider';
import {
  DEMO_ACCOUNT,
  DEMO_USER,
  buildArchiveThreads,
  buildHeldMessages,
  buildInboxThreads,
  buildKnownSenders,
} from './seed';

interface MockState {
  version: number;
  connectedAt: string;
  threads: Thread[];
  senders: Sender[];
  held: {
    senderId: string;
    messages: Message[];
    category: HeldSender['category'];
    aiRead: string;
  }[];
  known: Sender[];
  syncComplete: boolean;
}

const STORAGE_KEY = 'pigeon.demo';
const STATE_VERSION = 1;

/**
 * Latency that reads as "a real network" without slowing the app down. Tests
 * run without it — they are asserting behaviour, not the feel of a fetch.
 */
const LATENCY_MS = import.meta.env.MODE === 'test' ? 0 : 90;

function delay<T>(value: T, ms = LATENCY_MS): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}

function freshState(): MockState {
  const known = buildKnownSenders();
  const held = buildHeldMessages();

  // Senders who already appear in the inbox are approved from the start.
  const inbox = buildInboxThreads();
  const archive = buildArchiveThreads();
  const now = new Date().toISOString();

  const senders: Sender[] = [];
  const seenEmails = new Set<string>();
  for (const t of [...inbox, ...archive]) {
    for (const m of t.messages) {
      if (m.isFromUser) continue;
      const key = m.from.email.toLowerCase();
      if (seenEmails.has(key)) continue;
      seenEmails.add(key);
      const match = known.find((k) => k.email.toLowerCase() === key);
      senders.push({
        id: match?.id ?? `s-inbox-${senders.length}`,
        name: m.from.name,
        email: m.from.email,
        status: 'approved',
        decidedAt: now,
        knownReason: match?.knownReason,
        replyCount: match?.replyCount,
      });
    }
  }

  for (const h of held) senders.push(h.sender);

  return {
    version: STATE_VERSION,
    connectedAt: now,
    threads: [...inbox, ...archive],
    senders,
    held: held.map((h) => ({
      senderId: h.sender.id,
      messages: h.messages,
      category: h.category,
      aiRead: h.aiRead,
    })),
    known,
    syncComplete: false,
  };
}

function load(): MockState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as MockState;
      if (parsed.version === STATE_VERSION) return parsed;
    }
  } catch {
    // A corrupt or unavailable store just means a fresh demo account.
  }
  return freshState();
}

/**
 * The demo account. Backs the app when no Google account is connected, and
 * every test. State persists to localStorage so decisions survive a reload.
 */
export class MockMailProvider implements MailProvider {
  readonly kind = 'mock' as const;

  private state: MockState;

  constructor(state?: MockState) {
    this.state = state ?? load();
  }

  /** Wipes the demo account back to its seeded state. */
  static reset(): void {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Nothing to clear.
    }
  }

  private persist(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
    } catch {
      // Over quota or storage disabled — the demo still works in memory.
    }
  }

  private sender(id: string): Sender {
    const s = this.state.senders.find((x) => x.id === id);
    if (!s) throw new MailError('That sender is not in the demo account.', 'not-found');
    return s;
  }

  async getAccount(): Promise<Account> {
    return delay({
      email: DEMO_ACCOUNT.email,
      name: DEMO_ACCOUNT.name,
      connectedAt: this.state.connectedAt,
    });
  }

  async sync(onProgress: (p: SyncProgress) => void): Promise<void> {
    const total = 11_908;
    const steps: SyncProgress['step'][] = ['connect', 'contacts', 'history', 'senders'];

    onProgress({ total: null, done: 0, step: 'connect' });
    await delay(null, 320);

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      const from = Math.round((total * i) / steps.length);
      const to = Math.round((total * (i + 1)) / steps.length);
      for (let done = from; done < to; done += Math.round(total / 40)) {
        onProgress({ total, done, step });
        await delay(null, 55);
      }
    }

    onProgress({ total, done: total, step: 'complete' });
    this.state.syncComplete = true;
    this.persist();
  }

  async getKnownSenders(): Promise<Sender[]> {
    return delay(this.state.known.map((s) => ({ ...s })));
  }

  async approveKnownSenders(senderIds: string[]): Promise<void> {
    const now = new Date().toISOString();
    const wanted = new Set(senderIds);
    for (const known of this.state.known) {
      if (!wanted.has(known.id)) continue;
      const existing = this.state.senders.find((s) => s.id === known.id);
      if (existing) {
        existing.status = 'approved';
        existing.decidedAt = now;
      } else {
        this.state.senders.push({ ...known, status: 'approved', decidedAt: now });
      }
    }
    this.persist();
    return delay(undefined);
  }

  async listThreads(
    place: 'inbox' | 'archive',
    onPage?: (threads: Thread[]) => void,
  ): Promise<Thread[]> {
    const threads = this.state.threads
      .filter((t) => t.place === place)
      .sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt))
      .map((t) => ({ ...t }));

    const all = await delay(threads);
    // The demo holds everything in memory, so its one page is the whole list.
    // Called anyway: the contract is that a caller passing `onPage` hears from
    // it, and a provider that stays silent would let a consumer come to depend
    // on the final resolution alone.
    onPage?.(all);
    return all;
  }

  /**
   * The demo account is a seeded handful, all of it in memory: its first window
   * is everything, so there is never anything older to ask for.
   */
  hasOlder(): boolean {
    return false;
  }

  listOlder(place: 'inbox' | 'archive'): Promise<Thread[]> {
    return this.listThreads(place);
  }

  async getThread(threadId: string): Promise<Thread> {
    const t = this.state.threads.find((x) => x.id === threadId);
    if (!t) throw new MailError("This thread didn't load. It's still in Gmail.", 'not-found');
    return delay({ ...t });
  }

  async markRead(threadId: string, read: boolean): Promise<void> {
    const t = this.state.threads.find((x) => x.id === threadId);
    if (t) {
      t.unread = !read;
      this.persist();
    }
    return delay(undefined, 20);
  }

  async setPlace(threadId: string, place: 'inbox' | 'archive'): Promise<void> {
    const t = this.state.threads.find((x) => x.id === threadId);
    if (!t) throw new MailError("This thread didn't load. It's still in Gmail.", 'not-found');
    t.place = place;
    this.persist();
    return delay(undefined);
  }

  async listHeld(): Promise<HeldSender[]> {
    const held: HeldSender[] = [];
    for (const h of this.state.held) {
      const sender = this.state.senders.find((s) => s.id === h.senderId);
      if (!sender || sender.status !== 'unknown') continue;
      held.push({
        sender: { ...sender },
        messages: h.messages,
        aiRead: h.aiRead,
        category: h.category,
      });
    }
    // By each sender's *newest* held message, matching the Gmail provider.
    // `messages[0]` is their oldest, so the Screener led with whoever had been
    // waiting longest at the top of their own pile rather than with what had
    // just arrived — and because both providers had the same defect, fixing it
    // on the Gmail side alone would have left the demo showing a different
    // order from the product.
    const newest = (h: HeldSender) =>
      h.messages.reduce((latest, m) => (m.date > latest ? m.date : latest), '');
    held.sort((a, b) => newest(b).localeCompare(newest(a)));
    return delay(held);
  }

  async decideSender(senderId: string, decision: 'approved' | 'declined'): Promise<void> {
    const sender = this.sender(senderId);
    const now = new Date().toISOString();
    /*
     * §2.3's two reversal rules both turn on what the sender was *before*:
     * "reversing a decline only affects mail received after the reversal", and
     * "declining a previously approved sender leaves their existing inbox
     * threads in place and silences future mail". Deciding without looking at
     * the previous status broke both — a reversed decline pushed the old held
     * mail into the inbox as if it had just arrived, and declining someone
     * already approved deleted the mail of theirs the user had been reading.
     */
    const previous = sender.status;
    sender.status = decision;
    sender.decidedAt = now;

    if (decision === 'approved') {
      // §2.3 — held messages move to the Inbox, unread, dated today. Only mail
      // still waiting in the Screener; a reversal in Settings surfaces nothing.
      const held = previous === 'declined' ? undefined : this.state.held.find((h) => h.senderId === senderId);
      if (held) {
        for (const m of held.messages) {
          const existing = this.state.threads.find((t) => t.id === m.threadId);
          if (existing) {
            existing.place = 'inbox';
            existing.unread = true;
            existing.approvedAt = now;
            continue;
          }
          this.state.threads.push({
            id: m.threadId,
            subject: m.subject,
            place: 'inbox',
            unread: true,
            messages: [m],
            lastMessageAt: m.date,
            approvedAt: now,
          });
        }
      }
    } else if (previous !== 'approved') {
      // D7 — declining silences. Held threads leave Pigeon entirely. Only mail
      // that was still waiting: §2.3 leaves an approved sender's inbox threads
      // where they are, and silences their future mail instead.
      const held = this.state.held.find((h) => h.senderId === senderId);
      if (held) {
        const ids = new Set(held.messages.map((m) => m.threadId));
        this.state.threads = this.state.threads.filter((t) => !ids.has(t.id));
      }
    }

    this.persist();
    return delay(undefined);
  }

  async undecideSender(senderId: string): Promise<void> {
    const sender = this.sender(senderId);
    const wasApproved = sender.status === 'approved';
    sender.status = 'unknown';
    sender.decidedAt = undefined;

    const held = this.state.held.find((h) => h.senderId === senderId);
    if (held) {
      const ids = new Set(held.messages.map((m) => m.threadId));
      if (wasApproved) {
        // Pull the threads back out of the inbox; the sender returns to the stack.
        this.state.threads = this.state.threads.filter((t) => !ids.has(t.id));
      }
    }

    this.persist();
    return delay(undefined);
  }

  async listSenders(status: 'approved' | 'declined'): Promise<Sender[]> {
    const senders = this.state.senders
      .filter((s) => s.status === status)
      .sort((a, b) => (b.decidedAt ?? '').localeCompare(a.decidedAt ?? ''))
      .map((s) => ({ ...s }));
    return delay(senders);
  }

  async listContacts(): Promise<Address[]> {
    const approved = this.state.senders
      .filter((s) => s.status === 'approved')
      .map((s) => ({ name: s.name, email: s.email }));
    const known = this.state.known.map((s) => ({ name: s.name, email: s.email }));
    const seen = new Set<string>();
    const out: Address[] = [];
    for (const a of [...approved, ...known]) {
      const key = a.email.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(a);
    }
    return delay(out);
  }

  async send(draft: {
    to: Address[];
    cc: Address[];
    bcc: Address[];
    subject: string;
    body: string;
    threadId?: string;
    attachments?: OutgoingAttachment[];
  }): Promise<Message> {
    if (draft.to.length === 0) {
      throw new MailError(
        'Gmail didn\'t accept this message. Check the recipient addresses and send again.',
        'send-rejected',
      );
    }

    const message: Message = {
      id: `m-sent-${Date.now()}`,
      threadId: draft.threadId ?? `t-sent-${Date.now()}`,
      from: DEMO_USER,
      to: draft.to,
      cc: draft.cc,
      subject: draft.subject,
      body: draft.body,
      date: new Date().toISOString(),
      attachments: (draft.attachments ?? []).map((a) => ({
        id: a.id,
        filename: a.filename,
        size: a.size,
        mimeType: a.mimeType,
      })),
      isFromUser: true,
    };

    const existing = draft.threadId
      ? this.state.threads.find((t) => t.id === draft.threadId)
      : undefined;

    if (existing) {
      existing.messages = [...existing.messages, message];
      existing.lastMessageAt = message.date;
    } else {
      this.state.threads.push({
        id: message.threadId,
        subject: draft.subject || '(no subject)',
        place: 'inbox',
        unread: false,
        messages: [message],
        lastMessageAt: message.date,
      });
    }

    this.persist();
    return delay(message, 220);
  }

  async downloadAttachment(messageId: string, attachmentId: string): Promise<string> {
    const message = this.state.threads
      .flatMap((t) => t.messages)
      .find((m) => m.id === messageId);
    const found = message?.attachments.find((a) => a.id === attachmentId);
    if (!found) {
      throw new MailError("This attachment didn't download. It's still in Gmail.", 'not-found');
    }

    // The demo has no file store behind it. Rather than fail — which would make
    // a working affordance look broken — it hands back a readable placeholder
    // that says what the file would have been. Same shape as the real thing:
    // base64 bytes the caller turns into a download.
    const note =
      `${found.filename}\n\n` +
      `This is Pigeon's demo account, so there is no real file behind this ` +
      `attachment. Connect Gmail to download the real one.\n\n` +
      `${found.mimeType} · ${found.size} bytes\n`;
    return delay(btoa(unescape(encodeURIComponent(note))));
  }

  async unsend(messageId: string): Promise<void> {
    for (const t of this.state.threads) {
      const before = t.messages.length;
      t.messages = t.messages.filter((m) => m.id !== messageId);
      if (t.messages.length !== before) {
        if (t.messages.length === 0) {
          this.state.threads = this.state.threads.filter((x) => x.id !== t.id);
        } else {
          t.lastMessageAt = t.messages[t.messages.length - 1].date;
        }
        break;
      }
    }
    this.persist();
    return delay(undefined);
  }

  async search(query: string, includeHeld: boolean): Promise<SearchResults> {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return delay({ inbox: [], archive: [], held: [] });

    const matches = (t: Thread) =>
      t.subject.toLowerCase().includes(q) ||
      t.messages.some(
        (m) =>
          m.body.toLowerCase().includes(q) ||
          m.from.name.toLowerCase().includes(q) ||
          m.from.email.toLowerCase().includes(q),
      );

    const inbox = this.state.threads.filter((t) => t.place === 'inbox' && matches(t));
    const archive = this.state.threads.filter((t) => t.place === 'archive' && matches(t));

    let held: HeldSender[] = [];
    if (includeHeld) {
      const all = await this.listHeld();
      held = all.filter(
        (h) =>
          h.sender.name.toLowerCase().includes(q) ||
          h.sender.email.toLowerCase().includes(q) ||
          h.messages.some(
            (m) => m.subject.toLowerCase().includes(q) || m.body.toLowerCase().includes(q),
          ),
      );
    }

    const byDate = (a: Thread, b: Thread) => b.lastMessageAt.localeCompare(a.lastMessageAt);
    return delay({
      inbox: inbox.sort(byDate),
      archive: archive.sort(byDate),
      held,
    }, 180);
  }
}
