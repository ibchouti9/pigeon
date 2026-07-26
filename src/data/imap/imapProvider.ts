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
import { SenderDecisions } from '../decisions';
import { buildRawMessage } from '../mime';
import { invoke } from '../../lib/desktop';
import { mapThread } from './map';
import type {
  BridgeListPage,
  BridgeMailStatus,
  BridgeSentRecipient,
  BridgeStub,
  BridgeThread,
} from './bridge';

/**
 * Gmail over IMAP, through the Rust engine — the real-mail provider.
 *
 * `kind` stays `'gmail'` because that is what it is: a Gmail account. The
 * transport moved from the REST API to IMAP when onboarding moved from a
 * five-step OAuth console setup to an app password, but nothing above
 * `MailProvider` knows a wire exists, and the §2.3 rules applied here are the
 * same `SenderDecisions` machine the REST provider used.
 *
 * The division of labour: Rust owns connections, MIME and Gmail's IMAP
 * extensions; this class owns the product — what is visible where, who is
 * held, what a decision does — and a body cache, keyed by each conversation's
 * `lastUid:messageCount`, either of which changes whenever the conversation
 * does. That cache is what makes the walk affordable and §3.1 3b's "pick up
 * where it stopped" true.
 */

/** Sent-mail sample for D10's "people you have written to". */
const SENT_SCAN = 500;

/** Concurrent body fetches. IMAP is one connection; modest keeps it honest. */
const HYDRATE_BATCH = 5;

const SEARCH_CAP = 500;

interface Hydration {
  promise: Promise<Thread[]>;
  listeners: Set<(done: number, listed?: number) => void>;
  pageListeners: Set<(threads: Thread[]) => void>;
}

export class ImapMailProvider implements MailProvider {
  readonly kind = 'gmail' as const;

  private account: Account | null = null;
  /** §2.3's state machine, shared with anything that ever speaks for Gmail. */
  private decisions = SenderDecisions.load('');
  /** Lowercased addresses the user has written to (D10). */
  private known = new Set<string>();
  private contacts: Address[] = [];
  private buildingKnown: Promise<void> | null = null;

  /** threadId → hydrated thread, valid while `cacheKeys` agrees. */
  private threads = new Map<string, Thread>();
  private cacheKeys = new Map<string, string>();
  private hydrating = new Map<string, Hydration>();

  private async call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
    try {
      return await invoke<T>(command, args);
    } catch (error) {
      const message = typeof error === 'string' ? error : String(error);
      // Rust's error strings are already user-facing copy; what needs deciding
      // here is which §7.6 state the shell renders around them.
      if (message.includes("isn't connected")) {
        throw new MailError(
          'Pigeon lost access to your mail. Connect your account again to keep using Pigeon.',
          'revoked',
        );
      }
      if (message.includes("Couldn't reach")) {
        throw new MailError(message, 'unreachable');
      }
      throw new MailError(message, 'unknown');
    }
  }

  /* ------------------------------------------------------------------ */
  /* Account and the known set                                           */
  /* ------------------------------------------------------------------ */

  async getAccount(): Promise<Account> {
    if (this.account) return this.account;

    const status = await this.call<BridgeMailStatus>('mail_status');
    if (!status.connected || !status.email) {
      throw new MailError(
        'Pigeon lost access to your mail. Connect your account again to keep using Pigeon.',
        'revoked',
      );
    }

    this.account = {
      email: status.email,
      // IMAP has no profile endpoint. The address is the honest name until a
      // sent message teaches us better.
      name: status.email,
      connectedAt: new Date().toISOString(),
    };
    this.decisions = SenderDecisions.load(status.email);
    return this.account;
  }

  private userEmail(): string {
    return this.account?.email ?? '';
  }

  /**
   * D10's known set, from one source instead of two: the People API went with
   * OAuth, so "people you know" is people you have written to — which is also
   * the half of the old set that predicted approvals rather than merely
   * address-book membership.
   */
  private buildKnownSet(): Promise<void> {
    const inFlight = this.buildingKnown;
    if (inFlight) return inFlight;

    const build = (async () => {
      const recipients = await this.call<BridgeSentRecipient[]>('mail_sent_recipients', {
        limit: SENT_SCAN,
      });
      this.known.clear();
      this.contacts = [];
      for (const r of recipients) {
        this.known.add(r.email);
        this.contacts.push({ name: r.name, email: r.email });
      }
    })().finally(() => {
      this.buildingKnown = null;
    });
    this.buildingKnown = build;
    return build;
  }

  async getKnownSenders(): Promise<Sender[]> {
    if (this.known.size === 0) await this.buildKnownSet();
    return this.contacts.map((c) => ({
      id: c.email,
      name: c.name || c.email,
      email: c.email,
      status: 'unknown' as const,
      knownReason: 'replies' as const,
    }));
  }

  async approveKnownSenders(senderIds: string[]): Promise<void> {
    this.decisions.bulkApprove(senderIds);
  }

  async listContacts(): Promise<Address[]> {
    if (this.contacts.length === 0) await this.buildKnownSet();
    return this.contacts;
  }

  /* ------------------------------------------------------------------ */
  /* Reading                                                             */
  /* ------------------------------------------------------------------ */

  private isKnown(email: string): boolean {
    return this.known.has(email.toLowerCase()) || this.decisions.status(email) === 'approved';
  }

  private isDeclined(email: string): boolean {
    return this.decisions.status(email) === 'declined';
  }

  private heldInScreener(email: string): boolean {
    return !this.decisions.has(email) && !this.known.has(email.toLowerCase());
  }

  private threadSender(thread: Thread): Address | null {
    const incoming = thread.messages.find((m) => !m.isFromUser);
    return incoming?.from ?? null;
  }

  /** §2.3 — unknown senders belong in the Screener, declined ones nowhere. */
  private visible(threads: Thread[], place: 'inbox' | 'archive'): Thread[] {
    return threads.filter((thread) => {
      const sender = this.threadSender(thread);
      if (!sender) return true; // A thread the user started stays visible.
      if (this.decisions.hidden(thread, sender.email)) return false;
      return place === 'archive' || !this.heldInScreener(sender.email);
    });
  }

  private async fetchThread(stub: BridgeStub): Promise<Thread> {
    const key = `${stub.lastUid}:${stub.messageCount}`;
    const cached = this.threads.get(stub.id);
    if (cached && this.cacheKeys.get(stub.id) === key) return cached;

    const raw = await this.call<BridgeThread>('mail_get_thread', { threadId: stub.id });
    const thread = mapThread(raw, this.userEmail());
    this.threads.set(thread.id, thread);
    this.cacheKeys.set(thread.id, key);
    return thread;
  }

  /**
   * The walk: one cheap stub listing, then bodies a few at a time, streaming
   * pages as they land. Shared per place, and every caller's callbacks are
   * added to the one in flight — the shell fires loadThreads, loadHeld and
   * loadSenders together on mount, and three walks at once is exactly what a
   * first run cannot afford.
   */
  private hydrate(
    place: 'inbox' | 'archive',
    onProgress?: (done: number, listed?: number) => void,
    onPage?: (threads: Thread[]) => void,
  ): Promise<Thread[]> {
    const existing = this.hydrating.get(place);
    if (existing) {
      if (onProgress) existing.listeners.add(onProgress);
      if (onPage) existing.pageListeners.add(onPage);
      return existing.promise;
    }

    const listeners = new Set<(done: number, listed?: number) => void>();
    if (onProgress) listeners.add(onProgress);
    const pageListeners = new Set<(threads: Thread[]) => void>();
    if (onPage) pageListeners.add(onPage);

    const promise = this.walk(
      place,
      (done, listed) => listeners.forEach((l) => l(done, listed)),
      (partial) => pageListeners.forEach((l) => l(partial)),
    ).finally(() => this.hydrating.delete(place));

    this.hydrating.set(place, { promise, listeners, pageListeners });
    return promise;
  }

  private async walk(
    place: 'inbox' | 'archive',
    onProgress?: (done: number, listed?: number) => void,
    onPage?: (threads: Thread[]) => void,
  ): Promise<Thread[]> {
    await this.getAccount();

    const page = await this.call<BridgeListPage>('mail_list_threads', { place });
    const out: Thread[] = [];
    let done = 0;

    // An empty place still publishes once: a caller that passed onPage is
    // owed the final state however short the walk was, or its screen keeps
    // whatever it was showing before.
    if (page.threads.length === 0) {
      onProgress?.(0, 0);
      onPage?.([]);
    }

    for (let i = 0; i < page.threads.length; i += HYDRATE_BATCH) {
      const batch = page.threads.slice(i, i + HYDRATE_BATCH);
      const threads = await Promise.all(
        batch.map((stub) => this.fetchThread(stub).catch(() => null)),
      );
      out.push(...threads.filter((t): t is Thread => t !== null));

      done += batch.length;
      onProgress?.(done, page.total);
      // Newest first, same as the finished list, so the screen never reorders
      // under the reader as later pages land.
      onPage?.([...out].sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt)));
    }

    return out.sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt));
  }

  async sync(onProgress: (p: SyncProgress) => void): Promise<void> {
    await this.getAccount();
    onProgress({ total: null, done: 0, step: 'connect' });

    onProgress({ total: null, done: 0, step: 'contacts' });
    await this.buildKnownSet();

    const alreadyHeld = [...this.threads.values()].filter((t) => t.place === 'inbox').length;
    onProgress({ total: null, done: alreadyHeld, step: 'history' });

    let total: number | null = null;
    const threads = await this.hydrate('inbox', (done, listed) => {
      if (listed !== undefined) total = listed;
      onProgress({ total, done, step: 'history' });
    });
    total = threads.length;

    onProgress({ total, done: total, step: 'senders' });
    onProgress({ total, done: total, step: 'complete' });
  }

  async listThreads(
    place: 'inbox' | 'archive',
    onPage?: (threads: Thread[]) => void,
  ): Promise<Thread[]> {
    const all = await this.hydrate(
      place,
      undefined,
      onPage && ((partial: Thread[]) => onPage(this.visible(partial, place))),
    );
    return this.visible(all, place);
  }

  async getThread(threadId: string): Promise<Thread> {
    const cached = this.threads.get(threadId);
    if (cached) return cached;

    const raw = await this.call<BridgeThread>('mail_get_thread', { threadId });
    const thread = mapThread(raw, this.userEmail());
    this.threads.set(thread.id, thread);
    return thread;
  }

  async listHeld(): Promise<HeldSender[]> {
    const inbox = await this.hydrate('inbox');
    const bySender = new Map<string, HeldSender>();

    for (const thread of inbox) {
      const sender = this.threadSender(thread);
      if (!sender || this.isKnown(sender.email) || this.isDeclined(sender.email)) continue;

      const key = sender.email.toLowerCase();
      const messages = thread.messages.filter((m) => !m.isFromUser);
      const existing = bySender.get(key);
      if (existing) {
        existing.messages.push(...messages);
        continue;
      }
      bySender.set(key, {
        sender: {
          id: key,
          name: sender.name || sender.email,
          email: sender.email,
          status: 'unknown',
        },
        messages,
      });
    }

    // By each sender's *newest* held message — the Screener leads with what
    // just arrived, not with whoever has waited longest at the top of a pile.
    const newest = (h: HeldSender) =>
      h.messages.reduce((latest, m) => (m.date > latest ? m.date : latest), '');
    return [...bySender.values()].sort((a, b) => newest(b).localeCompare(newest(a)));
  }

  /* ------------------------------------------------------------------ */
  /* Writing                                                             */
  /* ------------------------------------------------------------------ */

  async markRead(threadId: string, read: boolean): Promise<void> {
    await this.call('mail_mark_read', { threadId, read });
    const cached = this.threads.get(threadId);
    if (cached) cached.unread = !read;
  }

  async setPlace(threadId: string, place: 'inbox' | 'archive'): Promise<void> {
    await this.call('mail_set_place', { threadId, place });
    const cached = this.threads.get(threadId);
    if (cached) cached.place = place;
  }

  async decideSender(senderId: string, decision: 'approved' | 'declined'): Promise<void> {
    const email = senderId.toLowerCase();
    const { screenerDecline } = this.decisions.decide(email, decision);
    if (!screenerDecline) return;

    /*
     * D7 — a Screener decline archives what was waiting, in Gmail itself,
     * under Pigeon/Declined — the user's real mailbox honours the decision
     * too, not just Pigeon's view of it.
     */
    const held = [...this.threads.values()].filter(
      (t) => t.place === 'inbox' && this.threadSender(t)?.email.toLowerCase() === email,
    );
    const silenced: string[] = [];
    for (const thread of held) {
      await this.call('mail_silence', { threadId: thread.id, silence: true }).catch(
        () => undefined,
      );
      silenced.push(thread.id);
      this.threads.delete(thread.id);
      this.cacheKeys.delete(thread.id);
    }
    this.decisions.addSilenced(email, silenced);
  }

  async undecideSender(senderId: string): Promise<void> {
    // §3.2 3c — the card returns to the top of the stack, and its mail with
    // it. `undecide` returns only what the reversed decision itself silenced.
    const restore = this.decisions.undecide(senderId);
    for (const threadId of restore) {
      await this.call('mail_silence', { threadId, silence: false }).catch(() => undefined);
    }
  }

  async listSenders(status: 'approved' | 'declined'): Promise<Sender[]> {
    return this.decisions
      .list(status)
      .map(({ email, name, at }) => ({
        id: email,
        name: name ?? email,
        email,
        status,
        decidedAt: at,
      }))
      .sort((a, b) => (b.decidedAt ?? '').localeCompare(a.decidedAt ?? ''));
  }

  /* ------------------------------------------------------------------ */
  /* Sending                                                             */
  /* ------------------------------------------------------------------ */

  async send(draft: {
    to: Address[];
    cc: Address[];
    bcc: Address[];
    subject: string;
    body: string;
    threadId?: string;
    attachments?: OutgoingAttachment[];
  }): Promise<Message> {
    const account = await this.getAccount();

    // In-Reply-To and References per RFC 2822, or every reply detaches into
    // its own thread — in Gmail and in the recipient's client alike.
    const parent = draft.threadId ? this.lastMessageOf(draft.threadId) : undefined;
    const rawUrl = buildRawMessage({
      from: { name: account.name, email: account.email },
      to: draft.to,
      cc: draft.cc,
      bcc: draft.bcc,
      subject: draft.subject,
      body: draft.body,
      attachments: draft.attachments,
      inReplyTo: parent?.messageId,
      references: parent?.references,
    });
    // mime.ts speaks base64url (Gmail REST's dialect); the mailer wants plain.
    const raw = rawUrl.replace(/-/g, '+').replace(/_/g, '/');

    try {
      await this.call('mail_send', {
        raw,
        to: [...draft.to, ...draft.cc, ...draft.bcc].map((a) => a.email),
      });
    } catch (error) {
      if (error instanceof MailError && error.code !== 'unknown') throw error;
      throw new MailError(
        error instanceof Error && error.message
          ? error.message
          : "This didn't send. Your draft is safe.",
        'send-rejected',
      );
    }

    // The reply's thread has changed on the server; forget the stale copy.
    if (draft.threadId) {
      this.threads.delete(draft.threadId);
      this.cacheKeys.delete(draft.threadId);
    }

    return {
      id: `sent-${Date.now()}`,
      threadId: draft.threadId ?? '',
      subject: draft.subject,
      from: { name: account.name, email: account.email },
      to: draft.to,
      cc: draft.cc,
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
  }

  private lastMessageOf(
    threadId: string,
  ): { messageId?: string; references?: string } | undefined {
    const thread = this.threads.get(threadId);
    const last = thread?.messages[thread.messages.length - 1];
    if (!last?.messageId) return undefined;

    const chain = thread!.messages
      .map((m) => m.messageId)
      .filter((id): id is string => Boolean(id));
    return { messageId: last.messageId, references: chain.join(' ') };
  }

  async unsend(messageId: string): Promise<void> {
    /*
     * SMTP cannot recall a message any more than the REST API could, and D8
     * forbids trashing the Sent copy. Recorded in PROGRESS as a limitation of
     * the real-mail path rather than papered over here.
     */
    void messageId;
  }

  async downloadAttachment(messageId: string, attachmentId: string): Promise<string> {
    // The id was minted in map.ts as "uid/partIndex".
    const [uid, index] = attachmentId.split('/').map((n) => Number.parseInt(n, 10));
    if (!Number.isFinite(uid) || !Number.isFinite(index)) {
      throw new MailError("This attachment didn't download. It's still in Gmail.", 'not-found');
    }
    void messageId;
    return this.call<string>('mail_attachment', { uid, index });
  }

  /* ------------------------------------------------------------------ */
  /* Search                                                              */
  /* ------------------------------------------------------------------ */

  async search(query: string, includeHeld: boolean): Promise<SearchResults> {
    const q = query.trim();
    if (q.length < 2) return { inbox: [], archive: [], held: [] };
    await this.getAccount();

    // Gmail's own query language, straight through X-GM-RAW. Same semantics
    // the REST provider's `q` parameter had, because they are the same engine.
    const page = await this.call<BridgeListPage>('mail_search', { query: q });
    const stubs = page.threads.slice(0, SEARCH_CAP);

    const threads: (Thread | null)[] = [];
    for (let i = 0; i < stubs.length; i += HYDRATE_BATCH) {
      threads.push(
        ...(await Promise.all(
          stubs.slice(i, i + HYDRATE_BATCH).map((s) => this.fetchThread(s).catch(() => null)),
        )),
      );
    }

    const inbox: Thread[] = [];
    const archive: Thread[] = [];
    const held: HeldSender[] = [];

    for (const thread of threads) {
      if (!thread) continue;
      const sender = this.threadSender(thread);

      // D7 — "never appears in Pigeon" is three places, not two.
      if (sender && this.decisions.hidden(thread, sender.email)) continue;

      const unknown = sender
        ? !this.isKnown(sender.email) && !this.isDeclined(sender.email)
        : false;

      if (unknown) {
        if (!includeHeld || !sender) continue;
        held.push({
          sender: {
            id: sender.email.toLowerCase(),
            name: sender.name || sender.email,
            email: sender.email,
            status: 'unknown',
          },
          messages: thread.messages.filter((m) => !m.isFromUser),
        });
        continue;
      }

      if (thread.place === 'inbox') inbox.push(thread);
      else archive.push(thread);
    }

    return { inbox, archive, held };
  }
}
