import type {
  Account,
  Address,
  HeldSender,
  MailView,
  Message,
  OutgoingAttachment,
  Place,
  Sender,
  SyncProgress,
  Thread,
} from '../../types';
import { MailError, type MailProvider, type SearchResults } from '../provider';
import { parseQuery } from '../query';
import { SenderDecisions } from '../decisions';
import { buildRawMessage } from '../mime';
import { invoke } from '../../lib/desktop';
import { mapStub, mapThread } from './map';
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

/**
 * Sent-mail sample for D10's "people you have written to".
 *
 * This is the one thing that reads the past deeply, and it is the cheapest
 * thing here: ENVELOPE only, 500 UIDs per FETCH, so four thousand messages is
 * eight round trips and no bodies. It is also what makes the screening cutoff
 * safe — everyone the user actually corresponds with is already known on day
 * one, so their mail goes to the inbox rather than to a stack of strangers.
 */
const SENT_SCAN = 4000;

/** Concurrent body fetches. IMAP is one connection; modest keeps it honest. */
const HYDRATE_BATCH = 5;

/**
 * How many rows a place lists at a time.
 *
 * The engine still counts the whole place — D34's totals are honest — but only
 * this many rows are fetched and rendered, and "Show older" asks for the next
 * window. The REST provider capped at 2,000 for the same reason and the IMAP
 * rewrite dropped the cap; a 40,000-thread account is what noticed.
 */
const PAGE_SIZE = 200;

const SEARCH_CAP = 500;

/**
 * The most conversations `listHeld` will open bodies for in one pass. Held
 * threads are the one place a body is genuinely needed before anyone clicks —
 * the Screener card shows a preview and the AI read summarises it — and after
 * the cutoff there are normally a handful. This is the guard for a first run
 * that inherits more than a handful.
 */
const HELD_HYDRATE_CAP = 60;

interface Hydration {
  promise: Promise<Thread[]>;
  listeners: Set<(done: number, listed?: number) => void>;
  pageListeners: Set<(threads: Thread[]) => void>;
}

/**
 * How long a listing is reused before it is asked for again.
 *
 * Every load used to re-list from the server, which was affordable only because
 * nobody had run it on a real mailbox: on a large account a listing is a SEARCH
 * and a metadata pass over every message in the place. The window is reused
 * instead — and, crucially, a sender decision does not need a fresh one, because
 * approving or declining changes only which of the *same* rows §2.3 shows.
 *
 * The ceiling keeps mail that arrived meanwhile from staying invisible for a
 * whole session, since Pigeon does not hold an IDLE connection.
 */
const WINDOW_TTL_MS = 30_000;

/** One place's listed rows, what it holds in total, and when it was fetched. */
interface Window {
  threads: Thread[];
  total: number;
  at: number;
}

/**
 * A conversation's body-cache key: its highest UID and its message count.
 * Either half changes whenever the conversation does, which is what makes a
 * cached body safe to reuse — and it is derivable from a listing row *and* from
 * a fetched conversation, so the two agree about what is fresh.
 */
function cacheKey(stub: BridgeStub): string {
  return `${stub.lastUid}:${stub.messageCount}`;
}

function fetchedKey(raw: BridgeThread): string {
  const lastUid = raw.messages.reduce((high, m) => (m.uid > high ? m.uid : high), 0);
  return `${lastUid}:${raw.messages.length}`;
}

export class ImapMailProvider implements MailProvider {
  readonly kind = 'gmail' as const;

  private account: Account | null = null;
  /** §2.3's state machine, shared with anything that ever speaks for Gmail. */
  private decisions = SenderDecisions.load('');
  /** Lowercased addresses the user has written to (D10). */
  private known = new Set<string>();
  /** Sent-mail correspondents, with how often each was written to (§5.3). */
  private contacts: (Address & { count: number })[] = [];
  private buildingKnown: Promise<void> | null = null;

  /** threadId → hydrated thread, valid while `cacheKeys` agrees. */
  private threads = new Map<string, Thread>();
  private cacheKeys = new Map<string, string>();
  private hydrating = new Map<string, Hydration>();
  /** Each place's listed rows and how many the place actually holds. */
  private windows = new Map<string, Window>();

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
    // Screening starts the first time this account is seen and never moves
    // afterwards — see `beginScreening`. Everything already in the mailbox is
    // history: it stays where Gmail put it and no one is asked to judge it.
    this.decisions.beginScreening(new Date().toISOString());
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
        // The engine counts how often each address was written to and this
        // dropped it, so O4 rendered "0 replies" against every row in the
        // list — a column of constants where the evidence should be.
        this.contacts.push({ name: r.name, email: r.email, count: r.count });
      }
    })().finally(() => {
      this.buildingKnown = null;
    });
    this.buildingKnown = build;
    return build;
  }

  async getKnownSenders(): Promise<Sender[]> {
    if (this.known.size === 0) await this.buildKnownSet();
    // Most-written-to first. §5.3 asks the user to ratify this list in one
    // pass, which they can only do if the people they actually correspond
    // with are at the top rather than wherever the sent scan happened to
    // reach them.
    return [...this.contacts]
      .sort((a, b) => b.count - a.count)
      .map((c) => ({
        id: c.email,
        name: c.name || c.email,
        email: c.email,
        status: 'unknown' as const,
        knownReason: 'replies' as const,
        replyCount: c.count,
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

  /**
   * Whether this conversation waits in the Screener.
   *
   * Takes the thread, not just the address, because the cutoff is part of the
   * answer: an unknown sender whose conversation predates the setup is not held
   * — that mail was already in the inbox before Pigeon existed and stays there.
   * Their *next* conversation is screened, because they are still unknown.
   */
  private heldInScreener(email: string, thread: Thread): boolean {
    if (this.decisions.has(email)) return false;
    if (this.known.has(email.toLowerCase())) return false;
    return this.decisions.screens(thread);
  }

  private threadSender(thread: Thread): Address | null {
    const incoming = thread.messages.find((m) => !m.isFromUser);
    return incoming?.from ?? null;
  }

  /** §2.3 — unknown senders belong in the Screener, declined ones nowhere. */
  private visible(threads: Thread[], view: MailView): Thread[] {
    /*
     * Sent and Drafts are the user's own writing, and §2.3 governs who may
     * reach *them*. Filtering these would mean a reply vanishing from your own
     * sent mail because you later declined the person you sent it to — the
     * record of what you wrote is not the sender's to affect.
     */
    if (view === 'sent' || view === 'drafts') return threads;

    return threads.filter((thread) => {
      const sender = this.threadSender(thread);
      if (!sender) return true; // A thread the user started stays visible.
      if (this.decisions.hidden(thread, sender.email)) return false;
      return view === 'archive' || !this.heldInScreener(sender.email, thread);
    });
  }


  /**
   * The listing: one window of rows, out of the engine's cheap pass, with no
   * bodies at all.
   *
   * This used to be a walk — list the stubs, then `mail_get_thread` every one of
   * them to find out who it was from. That is five round trips and every byte of
   * every message per row, serialised on the one IMAP connection, and on a
   * 40,000-thread account it is a first run measured in hours. A row needs a
   * name, a subject, a date and a preview line, and the engine now answers all
   * four in bulk.
   *
   * Shared per place, and every caller's callbacks join the one in flight — the
   * shell fires loadThreads, loadHeld and loadSenders together on mount.
   */
  private hydrate(
    place: MailView,
    onProgress?: (done: number, listed?: number) => void,
    onPage?: (threads: Thread[]) => void,
  ): Promise<Thread[]> {
    const cached = this.windows.get(place);
    if (cached && Date.now() - cached.at < WINDOW_TTL_MS) {
      onProgress?.(cached.threads.length, cached.total);
      onPage?.(cached.threads);
      return Promise.resolve(cached.threads);
    }

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

    // A refresh re-lists however deep the user had already paged, or one page
    // if they hadn't — "Show older" is not undone by the list going stale.
    const depth = Math.max(PAGE_SIZE, cached?.threads.length ?? 0);
    const promise = this.listWindow(place, 0, depth)
      .then((window) => {
        listeners.forEach((l) => l(window.threads.length, window.total));
        pageListeners.forEach((l) => l(window.threads));
        return window.threads;
      })
      .finally(() => this.hydrating.delete(place));

    this.hydrating.set(place, { promise, listeners, pageListeners });
    return promise;
  }

  /**
   * Fetches one window. An offset of zero replaces the place's rows; anything
   * else appends, which is what "Show older" does.
   */
  private async listWindow(
    place: MailView,
    offset: number,
    limit: number = PAGE_SIZE,
  ): Promise<Window> {
    await this.getAccount();

    const page = await this.call<BridgeListPage>('mail_list_threads', {
      place,
      offset,
      limit,
    });
    const rows = page.threads.map((stub) => {
      // A conversation already opened has real bodies; a listing must not
      // replace those with a preview line.
      const hydrated = this.threads.get(stub.id);
      const fresh = this.cacheKeys.get(stub.id) === cacheKey(stub);
      return hydrated && fresh ? hydrated : mapStub(stub);
    });

    const before = offset === 0 ? [] : (this.windows.get(place)?.threads ?? []);
    const seen = new Set(before.map((t) => t.id));
    const window: Window = {
      threads: [...before, ...rows.filter((t) => !seen.has(t.id))].sort((a, b) =>
        b.lastMessageAt.localeCompare(a.lastMessageAt),
      ),
      total: page.total,
      at: Date.now(),
    };
    this.windows.set(place, window);
    return window;
  }

  /** Drops rows from a place's listing without re-fetching it. */
  private dropRows(place: MailView, threadIds: string[]): void {
    const window = this.windows.get(place);
    if (!window) return;
    const gone = new Set(threadIds);
    const threads = window.threads.filter((t) => !gone.has(t.id));
    this.windows.set(place, {
      ...window,
      threads,
      total: Math.max(0, window.total - (window.threads.length - threads.length)),
    });
  }

  /**
   * Rewrites a listed row wherever it is listed, so the next load reads the
   * change instead of re-fetching the place to find out about it.
   */
  private updateRow(threadId: string, next: (row: Thread) => Thread): void {
    for (const [place, window] of this.windows) {
      const index = window.threads.findIndex((t) => t.id === threadId);
      if (index === -1) continue;
      const threads = [...window.threads];
      threads[index] = next(threads[index]);
      this.windows.set(place, { ...window, threads });
    }
  }

  /**
   * §5.2b, and it no longer walks anything.
   *
   * What setup actually does is read the sent-mail sample — which is what makes
   * the user's real correspondents known before their first inbox — and list the
   * first window of rows. Both are bounded and both are fast, so the counter
   * reports the rows it listed rather than a total in the tens of thousands it
   * used to spend an hour reaching.
   */
  async sync(onProgress: (p: SyncProgress) => void): Promise<void> {
    onProgress({ total: null, done: 0, step: 'connect' });
    await this.getAccount();

    onProgress({ total: null, done: 0, step: 'contacts' });
    await this.buildKnownSet();

    onProgress({ total: null, done: 0, step: 'history' });
    const threads = await this.hydrate('inbox');

    // D34's counter reports the *mailbox*, which the engine counts in full, not
    // the window that was listed — the two are 40,000 and 200 on a large
    // account, and the honest number is the one the user recognises.
    const total = this.windows.get('inbox')?.total ?? threads.length;
    const listed = threads.length;

    onProgress({ total, done: listed, step: 'senders' });
    onProgress({ total, done: listed, step: 'complete' });
  }

  async listThreads(
    place: MailView,
    onPage?: (threads: Thread[]) => void,
  ): Promise<Thread[]> {
    const all = await this.hydrate(
      place,
      undefined,
      onPage && ((partial: Thread[]) => onPage(this.visible(partial, place))),
    );
    return this.visible(all, place);
  }

  hasOlder(place: MailView): boolean {
    const window = this.windows.get(place);
    return window ? window.threads.length < window.total : false;
  }

  async listOlder(place: MailView): Promise<Thread[]> {
    const window = this.windows.get(place);
    if (!window || window.threads.length >= window.total) {
      return this.visible(window?.threads ?? [], place);
    }
    const next = await this.listWindow(place, window.threads.length);
    return this.visible(next.threads, place);
  }

  async getThread(threadId: string): Promise<Thread> {
    const cached = this.threads.get(threadId);
    if (cached) return cached;

    const raw = await this.call<BridgeThread>('mail_get_thread', { threadId });
    const thread = mapThread(raw, this.userEmail());
    this.threads.set(thread.id, thread);
    this.cacheKeys.set(thread.id, fetchedKey(raw));
    // The listed row for this thread was a preview; now that the real
    // conversation is here, the row becomes it — the reader and the list show
    // the same object, and the snippet stops being an approximation.
    this.updateRow(thread.id, () => thread);
    return thread;
  }

  /**
   * The Screener's stack. Bodies matter here — the card shows a preview and
   * §7.9's AI read summarises it — so held conversations are the one thing a
   * listing hydrates, and the cutoff is what keeps that affordable: after setup
   * this is the mail that has arrived since, not the mailbox.
   */
  async listHeld(): Promise<HeldSender[]> {
    const inbox = await this.hydrate('inbox');
    const held = inbox.filter((thread) => {
      const sender = this.threadSender(thread);
      return sender !== null && this.heldInScreener(sender.email, thread);
    });

    const hydrated: Thread[] = [];
    const wanted = held.slice(0, HELD_HYDRATE_CAP);
    for (let i = 0; i < wanted.length; i += HYDRATE_BATCH) {
      const batch = await Promise.all(
        wanted.slice(i, i + HYDRATE_BATCH).map(async (thread) => {
          if (!thread.preview) return thread;
          return this.getThread(thread.id).catch(() => thread);
        }),
      );
      hydrated.push(...batch);
    }
    // Past the cap the card still exists, with the preview line as its body —
    // a sender you cannot read is worse than a sender summarised in one line.
    hydrated.push(...held.slice(HELD_HYDRATE_CAP));

    const bySender = new Map<string, HeldSender>();
    for (const thread of hydrated) {
      const sender = this.threadSender(thread);
      if (!sender) continue;

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
    this.updateRow(threadId, (row) => ({ ...row, unread: !read }));
  }

  async setPlace(threadId: string, place: Place): Promise<void> {
    await this.call('mail_set_place', { threadId, place });
    const cached = this.threads.get(threadId);
    if (cached) cached.place = place;

    // The thread has left one place for the other (§2.1: exactly one place).
    // Moving the row rather than re-listing both is what keeps archiving from
    // costing a listing of the whole mailbox.
    const from = place === 'inbox' ? 'archive' : 'inbox';
    const row = this.windows.get(from)?.threads.find((t) => t.id === threadId);
    this.dropRows(from, [threadId]);
    const target = this.windows.get(place);
    if (target && row) {
      this.windows.set(place, {
        ...target,
        threads: [{ ...row, place }, ...target.threads].sort((a, b) =>
          b.lastMessageAt.localeCompare(a.lastMessageAt),
        ),
        total: target.total + 1,
      });
    }
  }

  async decideSender(senderId: string, decision: 'approved' | 'declined'): Promise<void> {
    const email = senderId.toLowerCase();
    const { screenerDecline } = this.decisions.decide(email, decision);
    if (!screenerDecline) return;

    /*
     * D7 — a Screener decline archives what was waiting, in Gmail itself,
     * under Pigeon/Declined — the user's real mailbox honours the decision
     * too, not just Pigeon's view of it.
     *
     * "What was waiting" is the listed inbox, not the body cache: a decline
     * follows a Screener card, and a Screener card is now built from rows that
     * may never have had their bodies fetched at all.
     */
    const held = (this.windows.get('inbox')?.threads ?? []).filter(
      (t) => this.threadSender(t)?.email.toLowerCase() === email,
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
    this.dropRows('inbox', silenced);
    this.decisions.addSilenced(email, silenced);
  }

  async undecideSender(senderId: string): Promise<void> {
    // §3.2 3c — the card returns to the top of the stack, and its mail with
    // it. `undecide` returns only what the reversed decision itself silenced.
    const restore = this.decisions.undecide(senderId);
    for (const threadId of restore) {
      await this.call('mail_silence', { threadId, silence: false }).catch(() => undefined);
    }
    // The decline dropped these rows from the listing; putting them back in
    // Gmail is only half of "and its mail with it".
    if (restore.length > 0) this.windows.delete('inbox');
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
    bodyHtml?: string;
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
      bodyHtml: draft.bodyHtml,
      attachments: draft.attachments,
      inReplyTo: parent?.messageId,
      references: parent?.references,
    });
    // mime.ts speaks base64url (Gmail REST's dialect, unpadded); the mailer
    // decodes standard base64 and is strict about the padding.
    const converted = rawUrl.replace(/-/g, '+').replace(/_/g, '/');
    const raw = converted.padEnd(Math.ceil(converted.length / 4) * 4, '=');

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
    const parsed = parseQuery(query);
    if (parsed.terms.length === 0) return { inbox: [], archive: [], held: [] };
    await this.getAccount();

    /*
     * Gmail's own query language, straight through X-GM-RAW — but the terms
     * rather than the raw string. Gmail ANDs bare words, so "what did priya say
     * about the window change" as typed matches nothing at all, while
     * `priya window change` finds the thread. An operator query
     * (`from:dana has:attachment`) survives untouched: `parseQuery` keeps
     * anything with punctuation in one piece, and those terms rejoin in the
     * same order they were typed.
     */
    const page = await this.call<BridgeListPage>('mail_search', {
      query: parsed.isQuestion ? parsed.terms.join(' ') : parsed.raw,
      limit: SEARCH_CAP,
    });

    // Rows, not conversations. Five hundred results used to be five hundred
    // `mail_get_thread` calls — 2,500 round trips and every byte of every
    // matching message — to draw a list that shows a name, a subject and a
    // line of preview. Opening a result fetches its bodies, like anywhere else.
    const threads: (Thread | null)[] = page.threads.map((stub) => {
      const hydrated = this.threads.get(stub.id);
      return hydrated && this.cacheKeys.get(stub.id) === cacheKey(stub)
        ? hydrated
        : mapStub(stub);
    });

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
