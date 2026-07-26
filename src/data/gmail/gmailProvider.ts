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
import { accessToken, AuthError } from './auth';
import {
  buildRawMessage,
  toMessage,
  type GmailMessage,
} from './mime';

const GMAIL = 'https://gmail.googleapis.com/gmail/v1/users/me';
const PEOPLE = 'https://people.googleapis.com/v1';

/** D7 — declined senders' mail is archived under this label, never deleted. */
const DECLINED_LABEL = 'Pigeon/Declined';

/** How far back "has been sent mail by the user" reaches (D10). */
const KNOWN_MONTHS = 24;

/** Gmail's own page size ceiling for threads.list. */
const PAGE_SIZE = 100;

/**
 * A ceiling on one place's listing. High enough that a working inbox is
 * complete — the Screener is what keeps it from growing without bound — and low
 * enough that a first run on a decade-old archive cannot walk away with someone
 * else's whole API quota.
 */
const MAX_THREADS = 2000;

/**
 * §5.11's meta line states a count, so the count has to mean something. Deep
 * enough that a realistic search is complete; a query matching more than this
 * wants narrowing, which is what "Try fewer words" already tells the user.
 */
const MAX_SEARCH_RESULTS = 200;

/**
 * How much of D10's 24-month sent window is actually read. Every message costs
 * a metadata request, and this runs during onboarding while the user watches a
 * progress bar — the point is to recognise the people someone writes to, and
 * the most recent couple of hundred conversations carry almost all of them.
 */
const MAX_SENT_SCAN = PAGE_SIZE * 2;

/** Google's guidance for both 429 and a rate-limit 403 is exponential backoff. */
const RETRIES = 4;
const BACKOFF_MS = 1000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * A 403 is either "you may not do this" or "not so fast". Only the body says
 * which, and treating them alike is how a throttle came to be reported as a
 * revoked account.
 */
async function isRateLimit(response: Response): Promise<boolean> {
  if (response.status !== 403) return false;
  try {
    const body = (await response.clone().json()) as {
      error?: { errors?: { reason?: string }[]; status?: string };
    };
    const reasons = (body.error?.errors ?? []).map((e) => e.reason ?? '');
    return (
      reasons.some((r) => /rateLimitExceeded|userRateLimitExceeded|dailyLimitExceeded/i.test(r)) ||
      body.error?.status === 'RESOURCE_EXHAUSTED'
    );
  } catch {
    return false;
  }
}

interface Decisions {
  /** Lowercased email → decision + ISO date. */
  [email: string]: {
    status: 'approved' | 'declined';
    at: string;
    name?: string;
    /**
     * Set when a decline reversed an approval. §2.3 keeps that sender's
     * existing threads and silences only what arrives afterwards; a decline
     * from the Screener silences everything (D7), which is the default.
     */
    keptExisting?: boolean;
    /**
     * Set when an approval reversed a decline. §2.3 surfaces only mail received
     * after the reversal, so their older conversations stay hidden.
     */
    reversedDecline?: boolean;
    /**
     * Threads `silence()` archived for this decision. §3.2 3c's undo has to put
     * them back, and nothing else knows which they were — the walk has already
     * forgotten them, because archiving is what removes them from it.
     */
    silenced?: string[];
  };
}

/**
 * Sender decisions live in this browser, keyed by account. Pigeon has no server
 * to sync them through (D41), and a Gmail label cannot express "this address may
 * reach me" for mail that has not arrived yet.
 */
function decisionsKey(email: string): string {
  return `pigeon.senders.${email.toLowerCase()}`;
}

function readDecisions(email: string): Decisions {
  try {
    return JSON.parse(localStorage.getItem(decisionsKey(email)) ?? '{}') as Decisions;
  } catch {
    return {};
  }
}

function writeDecisions(email: string, decisions: Decisions): void {
  try {
    localStorage.setItem(decisionsKey(email), JSON.stringify(decisions));
  } catch {
    // Decisions still apply for this page load.
  }
}

export class GmailMailProvider implements MailProvider {
  readonly kind = 'gmail' as const;

  private account: Account | null = null;
  private decisions: Decisions = {};
  /** Lowercased addresses the user has written to, or has in Contacts (D10). */
  private known = new Set<string>();
  private contacts: Address[] = [];
  private declinedLabelId: string | null = null;
  /** Cache of hydrated threads, so the list and reader share one fetch. */
  private threads = new Map<string, Thread>();
  /** Gmail's own change token per thread — the key to a cache that stays fresh. */
  private historyIds = new Map<string, string>();
  private hydrating = new Map<
    string,
    {
      promise: Promise<Thread[]>;
      listeners: Set<(done: number, listed?: number) => void>;
      pageListeners: Set<(threads: Thread[]) => void>;
    }
  >();
  private buildingKnown: Promise<void> | null = null;
  /** §7.6's "Contacts unreadable" — O4 has a state for it and needs telling. */
  private contactsFailed = false;

  private async call<T>(url: string, init: RequestInit = {}): Promise<T> {
    let token: string;
    try {
      token = await accessToken();
    } catch (error) {
      if (error instanceof AuthError) {
        throw new MailError(
          "Pigeon lost access to your mail. Google revoked Pigeon's permission. Connect your account again to keep using Pigeon.",
          'revoked',
        );
      }
      throw error;
    }

    /*
     * Gmail's per-user budget is 6,000 quota units a minute, and threads.get
     * costs 40 of them — so a walk of any real mailbox will meet a throttle.
     * Google's error guide returns those as 429, and also as 403 with a
     * `reason` of rateLimitExceeded / userRateLimitExceeded / dailyLimitExceeded,
     * and its advice for both is exponential backoff.
     *
     * Before this, every one of those read as 401/403 → "Google revoked
     * Pigeon's permission. Connect your account again." A throttle told the
     * user their account had been disconnected, and the only cure — waiting —
     * was the one thing that message doesn't suggest.
     */
    for (let attempt = 0; ; attempt++) {
      let response: Response;
      try {
        response = await fetch(url, {
          ...init,
          headers: { ...init.headers, authorization: `Bearer ${token}` },
        });
      } catch {
        throw new MailError(
          'Pigeon can\'t reach Gmail. Your mail is safe. This is a connection problem between Pigeon and Google.',
          'unreachable',
        );
      }

      if (response.status === 404) {
        throw new MailError("This thread didn't load. It's still in Gmail.", 'not-found');
      }
      if (response.status === 400) {
        // Gmail rejected the request itself — a malformed address, a message
        // over the size limit. Distinct from "can't reach Gmail", which is what
        // every non-2xx used to collapse into.
        throw new MailError(
          "Gmail didn't accept this message. Check the recipient addresses and send again.",
          'send-rejected',
        );
      }

      if (response.ok) {
        // A 204 carries no body, and `response.json()` throws on an empty one.
        // DELETE on a label is the reachable case today.
        const text = await response.text();
        return (text ? JSON.parse(text) : undefined) as T;
      }

      const throttled = response.status === 429 || (await isRateLimit(response));

      if (throttled && attempt < RETRIES) {
        await sleep(BACKOFF_MS * 2 ** attempt + Math.random() * 250);
        continue;
      }
      if (throttled) {
        throw new MailError(
          'Gmail is rate-limiting Pigeon. Your mail is safe — this will clear on its own.',
          'unreachable',
        );
      }

      if (response.status === 401 || response.status === 403) {
        throw new MailError(
          "Pigeon lost access to your mail. Google revoked Pigeon's permission. Connect your account again to keep using Pigeon.",
          'revoked',
        );
      }
      throw new MailError(
        'Pigeon can\'t reach Gmail. Your mail is safe. This is a connection problem between Pigeon and Google.',
        'unreachable',
      );
    }
  }

  private userEmail(): string {
    return this.account?.email ?? '';
  }

  private isKnown(email: string): boolean {
    const key = email.toLowerCase();
    return this.known.has(key) || this.decisions[key]?.status === 'approved';
  }

  private isDeclined(email: string): boolean {
    return this.decisions[email.toLowerCase()]?.status === 'declined';
  }

  /**
   * The Screener holds mail from senders the user has not ruled on yet. A
   * decided sender is never held — including a declined one, whose *existing*
   * mail §2.3 leaves in place; it is `silencedByDecline` that hides what
   * arrives afterwards.
   */
  private heldInScreener(email: string): boolean {
    const key = email.toLowerCase();
    return !this.decisions[key] && !this.known.has(key);
  }

  /**
   * §2.3 — declining "silences future mail" and, when the sender was already
   * approved, "leaves their existing inbox threads in place". So a decline
   * hides what arrives after it, not what was already being read. Mail that was
   * only ever waiting in the Screener is silenced by `silence()` at the moment
   * of the decision (D7), which archives it out of the inbox entirely — so
   * anything still here that predates the decline is mail the user had approved.
   */
  /**
   * When a thread started. A Gmail thread is one unit, so every rule below is
   * about the conversation rather than its latest message — asking about
   * `lastMessageAt` let a single reply drag an entire history across a cutoff.
   */
  private static startedAt(thread: Thread): string {
    return thread.messages.reduce(
      (earliest, m) => (m.date < earliest ? m.date : earliest),
      thread.lastMessageAt,
    );
  }

  /**
   * §2.3's decision rules, in one place, because all four cases turn on the
   * same two facts: what the sender's decision is, and whether it reversed an
   * earlier one.
   *
   * - Declined from the Screener — nothing of theirs appears, in either place
   *   (D7: "never appears in Pigeon").
   * - Declined after being approved — their existing conversations stay, and
   *   anything starting later is silenced ("their mail stays in your inbox;
   *   new mail stops").
   * - Approved after being declined — only mail from the reversal onwards
   *   ("reversing a decline only affects mail received after the reversal").
   * - Approved from the Screener — everything of theirs is theirs to see.
   */
  private hiddenByDecision(thread: Thread, email: string): boolean {
    const decision = this.decisions[email.toLowerCase()];
    if (!decision) return false;

    // Mail a Screener decline archived out of the inbox. §2.3 never resurfaces
    // it, whatever happens to the decision afterwards.
    if (decision.silenced?.includes(thread.id)) return true;

    if (decision.status === 'declined') {
      if (!decision.keptExisting) return true;
      return GmailMailProvider.startedAt(thread) >= decision.at;
    }

    // Approved. Only a reversal of a *hiding* decline holds anything back —
    // and only what arrived before it, since §2.3 surfaces nothing older.
    return (
      decision.reversedDecline === true &&
      GmailMailProvider.startedAt(thread) < decision.at
    );
  }


  async getAccount(): Promise<Account> {
    if (this.account) return this.account;

    const profile = await this.call<{ emailAddress: string }>(`${GMAIL}/profile`);
    let name = profile.emailAddress;
    try {
      const me = await this.call<{ names?: { displayName?: string }[] }>(
        `${PEOPLE}/people/me?personFields=names`,
      );
      name = me.names?.[0]?.displayName ?? name;
    } catch {
      // A missing display name is not worth failing sign-in over.
    }

    this.account = {
      email: profile.emailAddress,
      name,
      connectedAt: new Date().toISOString(),
    };
    this.decisions = readDecisions(this.account.email);
    return this.account;
  }

  /** Builds the known-sender set: Contacts, plus everyone written to (D10). */
  /**
   * Deduplicated for the same reason `hydrate` is: `sync`, `getKnownSenders`
   * and `listContacts` can all ask for this, and the "have we built it yet"
   * checks at the call sites all read false until the first one finishes. Two
   * callers meant two full contact-and-sent-mail walks.
   */
  private buildKnownSet(onProgress?: (done: number) => void): Promise<void> {
    const inFlight = this.buildingKnown;
    if (inFlight) return inFlight;

    const build = this.doBuildKnownSet(onProgress).finally(() => {
      this.buildingKnown = null;
    });
    this.buildingKnown = build;
    return build;
  }

  private async doBuildKnownSet(onProgress?: (done: number) => void): Promise<void> {
    this.contactsFailed = false;
    this.known.clear();
    this.contacts = [];

    try {
      let pageToken: string | undefined;
      do {
        const params = new URLSearchParams({
          personFields: 'names,emailAddresses',
          pageSize: '1000',
        });
        if (pageToken) params.set('pageToken', pageToken);
        const page = await this.call<{
          connections?: {
            names?: { displayName?: string }[];
            emailAddresses?: { value?: string }[];
          }[];
          nextPageToken?: string;
        }>(`${PEOPLE}/people/me/connections?${params}`);

        for (const person of page.connections ?? []) {
          const name = person.names?.[0]?.displayName ?? '';
          for (const address of person.emailAddresses ?? []) {
            if (!address.value) continue;
            this.known.add(address.value.toLowerCase());
            this.contacts.push({ name, email: address.value });
          }
        }
        pageToken = page.nextPageToken;
      } while (pageToken);
    } catch {
      /*
       * §7.6 has a row for this — "Pigeon couldn't read your contacts. You can
       * approve senders one at a time in the Screener instead." — and O4 has
       * the state built. Swallowing the failure here meant it could never be
       * shown: `known` came back holding only what the sent-scan found, so O4
       * said "Pigeon didn't find anyone to propose", the inbox looked empty and
       * the Screener held hundreds, with nothing anywhere explaining why.
       *
       * Enabling the People API is a separate step from enabling the Gmail API
       * in the Cloud console, so a project that has done one and not the other
       * gets exactly this — which makes it a likely first run, not an edge.
       */
      this.contactsFailed = true;
    }

    const since = new Date();
    since.setMonth(since.getMonth() - KNOWN_MONTHS);
    const after = Math.floor(since.getTime() / 1000);

    let pageToken: string | undefined;
    let scanned = 0;
    do {
      const params = new URLSearchParams({
        q: `in:sent after:${after}`,
        maxResults: String(PAGE_SIZE),
      });
      if (pageToken) params.set('pageToken', pageToken);
      const page = await this.call<{
        messages?: { id: string }[];
        nextPageToken?: string;
      }>(`${GMAIL}/messages?${params}`);

      const ids = (page.messages ?? []).map((m) => m.id);
      // Ten at a time, like every other fan-out here. This fired one request
      // per message in the page — up to a hundred at once, during onboarding,
      // which is exactly when a first run is most likely to meet a 429.
      const metadata: (GmailMessage | null)[] = [];
      for (let i = 0; i < ids.length; i += 10) {
        metadata.push(
          ...(await Promise.all(
            ids.slice(i, i + 10).map((id) =>
              this.call<GmailMessage>(
                `${GMAIL}/messages/${id}?format=metadata&metadataHeaders=To&metadataHeaders=Cc`,
              ).catch(() => null),
            ),
          )),
        );
      }

      for (const message of metadata) {
        for (const h of message?.payload?.headers ?? []) {
          if (!/^(to|cc)$/i.test(h.name)) continue;
          for (const match of h.value.matchAll(/[\w.+-]+@[\w-]+\.[\w.-]+/g)) {
            this.known.add(match[0].toLowerCase());
          }
        }
      }

      scanned += ids.length;
      onProgress?.(scanned);
      pageToken = page.nextPageToken;
      // Two pages of sent mail is enough signal for day one without making the
      // user wait on a full history walk.
    } while (pageToken && scanned < MAX_SENT_SCAN);
  }

  async sync(onProgress: (p: SyncProgress) => void): Promise<void> {
    await this.getAccount();
    onProgress({ total: null, done: 0, step: 'connect' });

    onProgress({ total: null, done: 0, step: 'contacts' });
    await this.buildKnownSet();

    /*
     * The denominator is what this walk will actually fetch, not
     * `profile.threadsTotal` — which is every thread in the mailbox, Sent and
     * Spam and Trash included. On a 40,000-thread account with a 300-thread
     * inbox, §5.2b read "300 of 40,000" and the bar sat near one per cent for
     * the whole sync before jumping to full. D34 asks for real counts.
     *
     * Until the first listing page comes back there is no honest number, and
     * `total: null` is what renders §7.3's "Counting your threads".
     */
    const alreadyHeld = [...this.threads.values()].filter((t) => t.place === 'inbox').length;
    onProgress({ total: null, done: alreadyHeld, step: 'history' });

    let total: number | null = null;
    const threads = await this.hydrate(
      'inbox',
      (done, listed) => {
        if (listed !== undefined) total = listed;
        onProgress({ total, done, step: 'history' });
      },
    );
    total = threads.length;

    onProgress({ total, done: total, step: 'senders' });
    onProgress({ total, done: total, step: 'complete' });
  }

  async getKnownSenders(): Promise<Sender[]> {
    if (this.known.size === 0) await this.buildKnownSet();
    if (this.contactsFailed) {
      throw new MailError(
        "Pigeon couldn't read your contacts. You can approve senders one at a time in the Screener instead.",
        'unreachable',
      );
    }

    const byEmail = new Map<string, Sender>();
    for (const contact of this.contacts) {
      const key = contact.email.toLowerCase();
      byEmail.set(key, {
        id: key,
        name: contact.name || contact.email,
        email: contact.email,
        status: 'unknown',
        knownReason: 'contact',
      });
    }
    for (const email of this.known) {
      if (byEmail.has(email)) {
        byEmail.get(email)!.knownReason = 'replies';
        continue;
      }
      byEmail.set(email, {
        id: email,
        name: email,
        email,
        status: 'unknown',
        knownReason: 'replies',
      });
    }
    return [...byEmail.values()];
  }

  async approveKnownSenders(senderIds: string[]): Promise<void> {
    const at = new Date().toISOString();
    for (const id of senderIds) {
      this.decisions[id.toLowerCase()] = { status: 'approved', at };
    }
    writeDecisions(this.userEmail(), this.decisions);
  }

  /**
   * Fetches and caches every thread in a place, newest first.
   *
   * The listing is paginated. It used to ask for a single page of
   * `PAGE_SIZE` and stop, so a real mailbox showed its most recent 100 threads
   * and silently pretended that was all of them — against D34, whose sync
   * counter reports totals in the thousands, and D38's "capped at no page size"
   * philosophy for the one list the spec does discuss.
   *
   * Thread bodies are cached against Gmail's own `historyId`, which changes
   * whenever anything in the thread does. That is what makes the walk
   * affordable: listing is one request per hundred threads, and a body is
   * fetched once and then only again when it has actually changed. It also
   * gives §3.1 3b's "pick up where it stopped" for free, without the cache
   * freezing the mailbox at whatever it looked like on first load.
   */
  private hydrate(
    place: 'inbox' | 'archive',
    onProgress?: (done: number, listed?: number) => void,
    onPage?: (threads: Thread[]) => void,
  ): Promise<Thread[]> {
    /*
     * The shell fires loadThreads, loadHeld and loadSenders together on mount,
     * and all three walk the inbox. Without this they each started their own
     * pagination before any of them had populated the cache — three times the
     * requests at exactly the moment a first run can least afford them.
     */
    /*
     * Every caller's callback, not just the first one's. Returning the in-flight
     * promise and dropping the incoming `onProgress` meant that if the shell's
     * loadThreads started the walk before `sync` asked for it, §5.2b's counter
     * never moved until the whole thing resolved — the one screen in the
     * product whose entire job is showing that something is happening.
     */
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
      (done, listed) => {
        for (const listener of listeners) listener(done, listed);
      },
      (partial) => {
        for (const listener of pageListeners) listener(partial);
      },
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

    // Trash and spam are excluded by default; drafts and chats are not, and
    // neither is archived mail.
    const query =
      place === 'inbox' ? 'in:inbox' : '-in:inbox -in:sent -in:drafts -in:chats';
    const listed: { id: string; historyId?: string }[] = [];
    let pageToken: string | undefined;

    do {
      const params = new URLSearchParams({ q: query, maxResults: String(PAGE_SIZE) });
      if (pageToken) params.set('pageToken', pageToken);
      const page = await this.call<{
        threads?: { id: string; historyId?: string }[];
        nextPageToken?: string;
      }>(`${GMAIL}/threads?${params}`);

      listed.push(...(page.threads ?? []));
      pageToken = page.nextPageToken;
    } while (pageToken && listed.length < MAX_THREADS);

    const out: Thread[] = [];
    const pending: { id: string; historyId?: string }[] = [];
    for (const entry of listed) {
      const cached = this.threads.get(entry.id);
      const unchanged =
        cached && cached.place === place && entry.historyId
          ? this.historyIds.get(entry.id) === entry.historyId
          : false;
      if (cached && unchanged) out.push(cached);
      else pending.push(entry);
    }
    let done = out.length;
    onProgress?.(done, listed.length);

    // Gmail rate-limits hard on parallel fetches; ten at a time is comfortable.
    for (let i = 0; i < pending.length; i += 10) {
      const slice = pending.slice(i, i + 10);
      const batch = await Promise.all(
        slice.map((entry) =>
          this.call<{ id: string; messages?: GmailMessage[] }>(
            `${GMAIL}/threads/${entry.id}?format=full`,
          )
            .then((raw) => {
              if (entry.historyId) this.historyIds.set(entry.id, entry.historyId);
              return raw;
            })
            .catch(() => null),
        ),
      );

      for (const raw of batch) {
        if (!raw?.messages?.length) continue;
        const messages = raw.messages.map((m) => toMessage(m, this.userEmail()));
        const thread: Thread = {
          id: raw.id,
          subject: messages[0].subject || '(no subject)',
          place,
          unread: raw.messages.some((m) => m.labelIds?.includes('UNREAD')),
          messages,
          lastMessageAt: messages[messages.length - 1].date,
        };
        this.threads.set(thread.id, thread);
        out.push(thread);
      }

      done += batch.length;
      onProgress?.(done, listed.length);
      // Newest first, same as the finished list, so the screen never reorders
      // under the reader as later pages land.
      onPage?.([...out].sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt)));
    }

    return out.sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt));
  }

  /** The sender of a thread, for the known/unknown split. */
  private threadSender(thread: Thread): Address | null {
    const incoming = thread.messages.find((m) => !m.isFromUser);
    return incoming?.from ?? null;
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

  /** §2.3 — unknown senders belong in the Screener, declined ones nowhere. */
  private visible(threads: Thread[], place: 'inbox' | 'archive'): Thread[] {
    return threads.filter((thread) => {
      const sender = this.threadSender(thread);
      if (!sender) return true; // A thread the user started stays visible.
      if (this.hiddenByDecision(thread, sender.email)) return false;
      return place === 'archive' || !this.heldInScreener(sender.email);
    });
  }

  async getThread(threadId: string): Promise<Thread> {
    const cached = this.threads.get(threadId);
    if (cached) return cached;

    const raw = await this.call<{ id: string; messages?: GmailMessage[] }>(
      `${GMAIL}/threads/${threadId}?format=full`,
    );
    if (!raw.messages?.length) {
      throw new MailError("This thread didn't load. It's still in Gmail.", 'not-found');
    }

    const messages = raw.messages.map((m) => toMessage(m, this.userEmail()));
    const thread: Thread = {
      id: raw.id,
      subject: messages[0].subject || '(no subject)',
      place: raw.messages.some((m) => m.labelIds?.includes('INBOX')) ? 'inbox' : 'archive',
      unread: raw.messages.some((m) => m.labelIds?.includes('UNREAD')),
      messages,
      lastMessageAt: messages[messages.length - 1].date,
    };
    this.threads.set(thread.id, thread);
    return thread;
  }

  async markRead(threadId: string, read: boolean): Promise<void> {
    await this.call(`${GMAIL}/threads/${threadId}/modify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(
        read ? { removeLabelIds: ['UNREAD'] } : { addLabelIds: ['UNREAD'] },
      ),
    });
    const cached = this.threads.get(threadId);
    if (cached) cached.unread = !read;
  }

  async setPlace(threadId: string, place: 'inbox' | 'archive'): Promise<void> {
    await this.call(`${GMAIL}/threads/${threadId}/modify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(
        place === 'archive' ? { removeLabelIds: ['INBOX'] } : { addLabelIds: ['INBOX'] },
      ),
    });
    const cached = this.threads.get(threadId);
    if (cached) cached.place = place;
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

    // By each sender's *newest* held message. `messages[0]` is their oldest, so
    // the Screener led with whoever had been waiting longest at the top of
    // their own pile rather than with what just arrived.
    const newest = (h: HeldSender) =>
      h.messages.reduce((latest, m) => (m.date > latest ? m.date : latest), '');
    return [...bySender.values()].sort((a, b) =>
      newest(b).localeCompare(newest(a)),
    );
  }

  private async ensureDeclinedLabel(): Promise<string> {
    if (this.declinedLabelId) return this.declinedLabelId;

    const labels = await this.call<{ labels?: { id: string; name: string }[] }>(
      `${GMAIL}/labels`,
    );
    const existing = labels.labels?.find((l) => l.name === DECLINED_LABEL);
    if (existing) {
      this.declinedLabelId = existing.id;
      return existing.id;
    }

    const created = await this.call<{ id: string }>(`${GMAIL}/labels`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: DECLINED_LABEL,
        labelListVisibility: 'labelShow',
        messageListVisibility: 'show',
      }),
    });
    this.declinedLabelId = created.id;
    return created.id;
  }

  async decideSender(senderId: string, decision: 'approved' | 'declined'): Promise<void> {
    const email = senderId.toLowerCase();
    const previous = this.decisions[email]?.status;
    const before = this.decisions[email];
    this.decisions[email] = {
      status: decision,
      at: new Date().toISOString(),
      keptExisting: decision === 'declined' && previous === 'approved',
      /*
       * Only a decline that *hid* mail. A decline that reversed an approval
       * kept the sender's conversations on screen, so approving them again has
       * nothing to hold back — treating the two alike meant approving a sender
       * made their mail disappear, with no way back short of clearing storage.
       */
      reversedDecline:
        decision === 'approved' && previous === 'declined' && before?.keptExisting !== true,
      // Carried across every later decision: what one decline archived stays
      // archived, so a decline → approve → decline cycle cannot surface it.
      silenced: before?.silenced,
    };
    writeDecisions(this.userEmail(), this.decisions);

    if (decision === 'approved') {
      // Their mail is already in the inbox; nothing to change in Gmail. And
      // §2.3 — reversing a decline "only affects mail received after the
      // reversal", so what `silence` archived stays archived.
      return;
    }

    /*
     * §2.3 — "reversing an approval (declining a previously approved sender)
     * leaves their existing inbox threads in place and silences future mail."
     * D7's silencing is for mail that was still waiting in the Screener; a
     * sender the user had already approved has mail they have been reading, and
     * archiving it out from under them is not what declining them means.
     */
    if (previous === 'approved') return;

    /*
     * D7 — "declined senders' future mail is archived in Gmail under the label
     * Pigeon/Declined and never appears in Pigeon."
     *
     * Pigeon does this itself rather than installing a Gmail filter. A filter
     * needs `gmail.settings.basic`, a fifth scope — and §3.1's consent copy
     * says "all four permissions", so asking for a fifth would make that
     * sentence false. Every filter call was 403ing anyway, silently, so a
     * declined sender's mail kept arriving in the user's real Gmail inbox
     * forever while Pigeon reported success.
     *
     * Doing it here also covers the half D7 states plainly and a filter never
     * could: the mail already sitting in the inbox.
     */
    await this.silence(email);
  }

  /** Archives every inbox thread from one address under `Pigeon/Declined`. */
  private async silence(email: string): Promise<void> {
    const labelId = await this.ensureDeclinedLabel().catch(() => null);
    if (!labelId) return;

    const threads = [...this.threads.values()].filter(
      (t) => t.place === 'inbox' && this.threadSender(t)?.email.toLowerCase() === email,
    );

    const silenced: string[] = [];
    for (const thread of threads) {
      await this.call(`${GMAIL}/threads/${thread.id}/modify`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ addLabelIds: [labelId], removeLabelIds: ['INBOX'] }),
      }).catch(() => undefined);
      silenced.push(thread.id);
      this.threads.delete(thread.id);
      this.historyIds.delete(thread.id);
    }

    // §3.2 3c's undo needs these back, and once they are out of the inbox the
    // walk cannot find them again.
    const decision = this.decisions[email];
    if (decision) {
      decision.silenced = [...(decision.silenced ?? []), ...silenced];
      writeDecisions(this.userEmail(), this.decisions);
    }
  }

  /** Puts back what `silence()` archived, for §3.2 3c's undo. */
  private async unsilence(ids: string[]): Promise<void> {
    const labelId = await this.ensureDeclinedLabel().catch(() => null);
    for (const id of ids) {
      await this.call(`${GMAIL}/threads/${id}/modify`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          addLabelIds: ['INBOX'],
          removeLabelIds: labelId ? [labelId] : [],
        }),
      }).catch(() => undefined);
    }
  }

  async undecideSender(senderId: string): Promise<void> {
    const email = senderId.toLowerCase();
    const previous = this.decisions[email];
    delete this.decisions[email];
    writeDecisions(this.userEmail(), this.decisions);

    /*
     * §3.2 3c — "the card returns to the top of the stack", and its mail with
     * it. Forgetting the decision is not the whole of it on this path: a
     * decline runs `silence()`, which takes those threads out of the Gmail
     * inbox, and the walk that builds the Screener never sees them again. The
     * undo the toast offers silently restored nothing.
     *
     * Only what this decision silenced. A reversal in Settings is a different
     * thing and §2.3 keeps it that way — it surfaces no old mail.
     */
    if (previous?.status === 'declined' && previous.silenced?.length) {
      await this.unsilence(previous.silenced);
    }
  }

  async listSenders(status: 'approved' | 'declined'): Promise<Sender[]> {
    return Object.entries(this.decisions)
      .filter(([, d]) => d.status === status)
      .map(([email, d]) => ({
        id: email,
        name: d.name ?? email,
        email,
        status,
        decidedAt: d.at,
      }))
      .sort((a, b) => (b.decidedAt ?? '').localeCompare(a.decidedAt ?? ''));
  }

  async listContacts(): Promise<Address[]> {
    if (this.contacts.length === 0) await this.buildKnownSet();
    return this.contacts;
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
    const account = await this.getAccount();

    /*
     * Gmail's own guide is explicit: to add a message to a thread, In-Reply-To
     * and References must be set per RFC 2822 *and* the subject must match —
     * threadId alone is not enough. Without them every reply Pigeon sent
     * detached into its own thread, in Gmail and in the recipient's client, and
     * the conversation the user was reading never updated.
     */
    const parent = draft.threadId ? this.lastMessageOf(draft.threadId) : undefined;
    const raw = buildRawMessage({
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

    let sent: GmailMessage;
    try {
      sent = await this.call<GmailMessage>(`${GMAIL}/messages/send`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(draft.threadId ? { raw, threadId: draft.threadId } : { raw }),
      });
    } catch (error) {
      // §7.6 keeps its own line for a revoked token and for being offline. This
      // used to rewrite every failure into "check the recipient addresses",
      // which told a user with an expired token to check addresses that were
      // perfectly good.
      if (error instanceof MailError) throw error;
      throw new MailError(
        "Gmail didn't accept this message. Check the recipient addresses and send again.",
        'send-rejected',
      );
    }

    // Both: the thread it landed in, and the one it was a reply to. Deleting
    // only the former left the original's stale copy in place, so the reply
    // didn't appear after a reload either.
    this.threads.delete(sent.threadId);
    this.historyIds.delete(sent.threadId);
    if (draft.threadId) {
      this.threads.delete(draft.threadId);
      this.historyIds.delete(draft.threadId);
    }
    return {
      id: sent.id,
      threadId: sent.threadId,
      from: { name: account.name, email: account.email },
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
  }

  /**
   * The newest message in a thread, with the References chain a reply needs.
   * RFC 5322 says References is the parent's References plus its Message-ID.
   */
  private lastMessageOf(threadId: string): { messageId?: string; references?: string } | undefined {
    const thread = this.threads.get(threadId);
    const last = thread?.messages[thread.messages.length - 1];
    if (!last?.messageId) return undefined;

    const chain = thread!.messages
      .map((m) => m.messageId)
      .filter((id): id is string => Boolean(id));
    return { messageId: last.messageId, references: chain.join(' ') };
  }

  async downloadAttachment(messageId: string, attachmentId: string): Promise<string> {
    const body = await this.call<{ data?: string }>(
      `${GMAIL}/messages/${messageId}/attachments/${attachmentId}`,
    );
    if (!body.data) {
      throw new MailError("This attachment didn't download. It's still in Gmail.", 'not-found');
    }
    // Gmail returns base64url; atob and a data: URL both want plain base64.
    return body.data.replace(/-/g, '+').replace(/_/g, '/');
  }

  async unsend(messageId: string): Promise<void> {
    /*
     * Gmail cannot recall a sent message, and D8 forbids trashing it. This used
     * to remove the INBOX label from something that only carries SENT — the
     * request succeeded, changed nothing, and §3.4's undo reported success for
     * a message already in the recipient's mailbox.
     *
     * Holding the send for the undo window instead would make the promise true,
     * but it trades a lying button for something worse: close the tab inside
     * those eight seconds and the mail silently never goes. Gmail's own undo
     * works because Google's servers hold it, which a browser client cannot do.
     * Recorded in PROGRESS as a limitation of the Gmail path rather than papered
     * over here.
     */
    void messageId;
  }

  async search(query: string, includeHeld: boolean): Promise<SearchResults> {
    const q = query.trim();
    if (q.length < 2) return { inbox: [], archive: [], held: [] };

    /*
     * Paginated to a ceiling, like the main walk. One page of 50 meant §5.11's
     * meta line said "50 results" for a query that matched five hundred — the
     * count is the whole point of that line, and it was stating the size of the
     * page rather than the size of the answer.
     */
    const ids: string[] = [];
    let pageToken: string | undefined;
    do {
      const params = new URLSearchParams({ q, maxResults: String(PAGE_SIZE) });
      if (pageToken) params.set('pageToken', pageToken);
      const page = await this.call<{ threads?: { id: string }[]; nextPageToken?: string }>(
        `${GMAIL}/threads?${params}`,
      );
      ids.push(...(page.threads ?? []).map((t) => t.id));
      pageToken = page.nextPageToken;
    } while (pageToken && ids.length < MAX_SEARCH_RESULTS);

    // Batched for the same reason the walk is: Gmail rate-limits hard on
    // parallel fetches, and this used to fire one request per result at once.
    const threads: (Thread | null)[] = [];
    for (let i = 0; i < ids.length; i += 10) {
      threads.push(
        ...(await Promise.all(
          ids.slice(i, i + 10).map((id) => this.getThread(id).catch(() => null)),
        )),
      );
    }

    const inbox: Thread[] = [];
    const archive: Thread[] = [];
    const held: HeldSender[] = [];

    for (const thread of threads) {
      if (!thread) continue;
      const sender = this.threadSender(thread);
      const unknown = sender ? !this.isKnown(sender.email) && !this.isDeclined(sender.email) : false;

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
