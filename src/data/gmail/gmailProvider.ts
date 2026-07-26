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

interface Decisions {
  /** Lowercased email → decision + ISO date. */
  [email: string]: { status: 'approved' | 'declined'; at: string; name?: string };
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

    let response: Response;
    try {
      response = await fetch(url, {
        ...init,
        headers: {
          ...init.headers,
          authorization: `Bearer ${token}`,
        },
      });
    } catch {
      throw new MailError(
        'Pigeon can\'t reach Gmail. Your mail is safe. This is a connection problem between Pigeon and Google.',
        'unreachable',
      );
    }

    if (response.status === 401 || response.status === 403) {
      throw new MailError(
        "Pigeon lost access to your mail. Google revoked Pigeon's permission. Connect your account again to keep using Pigeon.",
        'revoked',
      );
    }
    if (response.status === 404) {
      throw new MailError("This thread didn't load. It's still in Gmail.", 'not-found');
    }
    if (!response.ok) {
      throw new MailError(
        'Pigeon can\'t reach Gmail. Your mail is safe. This is a connection problem between Pigeon and Google.',
        'unreachable',
      );
    }

    return (await response.json()) as T;
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
  private async buildKnownSet(onProgress?: (done: number) => void): Promise<void> {
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
      // §7.6 — a contacts failure is recoverable; senders can be approved one
      // at a time in the Screener instead.
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
      const metadata = await Promise.all(
        ids.map((id) =>
          this.call<GmailMessage>(
            `${GMAIL}/messages/${id}?format=metadata&metadataHeaders=To&metadataHeaders=Cc`,
          ).catch(() => null),
        ),
      );

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
    } while (pageToken && scanned < PAGE_SIZE * 2);
  }

  async sync(onProgress: (p: SyncProgress) => void): Promise<void> {
    await this.getAccount();
    onProgress({ total: null, done: 0, step: 'connect' });

    onProgress({ total: null, done: 0, step: 'contacts' });
    await this.buildKnownSet();

    // Not zero: on a resumed run (§3.1 3b) the count starts at what is already
    // held, or the step tick alone would make it look like a fresh start.
    const alreadyHeld = [...this.threads.values()].filter((t) => t.place === 'inbox').length;
    onProgress({ total: null, done: alreadyHeld, step: 'history' });
    const profile = await this.call<{ threadsTotal?: number }>(`${GMAIL}/profile`);
    const total = profile.threadsTotal ?? 0;

    await this.hydrate('inbox', (done) => onProgress({ total, done, step: 'history' }));

    onProgress({ total, done: total, step: 'senders' });
    onProgress({ total, done: total, step: 'complete' });
  }

  async getKnownSenders(): Promise<Sender[]> {
    if (this.known.size === 0) await this.buildKnownSet();

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

  /** Fetches and caches every thread in a place, newest first. */
  private async hydrate(
    place: 'inbox' | 'archive',
    onProgress?: (done: number) => void,
  ): Promise<Thread[]> {
    await this.getAccount();

    const query = place === 'inbox' ? 'in:inbox' : '-in:inbox -in:sent -in:trash -in:spam';
    const list = await this.call<{ threads?: { id: string }[] }>(
      `${GMAIL}/threads?${new URLSearchParams({ q: query, maxResults: String(PAGE_SIZE) })}`,
    );

    const ids = (list.threads ?? []).map((t) => t.id);
    const out: Thread[] = [];

    /*
     * §3.1 3b — "Start sync again … Pigeon will pick up where it stopped".
     * A retry after a failure at 4,312 of 11,908 threads used to re-fetch all
     * 4,312, so the promise in the copy was false and the second attempt was
     * as slow as the first. Threads already hydrated are counted as done and
     * skipped; only what is actually missing goes back over the wire.
     */
    const pending: string[] = [];
    for (const id of ids) {
      const cached = this.threads.get(id);
      if (cached && cached.place === place) out.push(cached);
      else pending.push(id);
    }
    let done = out.length;
    onProgress?.(done);

    // Gmail rate-limits hard on parallel fetches; ten at a time is comfortable.
    for (let i = 0; i < pending.length; i += 10) {
      const batch = await Promise.all(
        pending.slice(i, i + 10).map((id) =>
          this.call<{ id: string; messages?: GmailMessage[] }>(
            `${GMAIL}/threads/${id}?format=full`,
          ).catch(() => null),
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
      onProgress?.(done);
    }

    return out.sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt));
  }

  /** The sender of a thread, for the known/unknown split. */
  private threadSender(thread: Thread): Address | null {
    const incoming = thread.messages.find((m) => !m.isFromUser);
    return incoming?.from ?? null;
  }

  async listThreads(place: 'inbox' | 'archive'): Promise<Thread[]> {
    const all = await this.hydrate(place);
    return all.filter((thread) => {
      const sender = this.threadSender(thread);
      if (!sender) return true; // A thread the user started stays visible.
      if (this.isDeclined(sender.email)) return false;
      // Unknown senders belong in the Screener, not the Inbox (§2.3).
      return place === 'archive' || this.isKnown(sender.email);
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

    return [...bySender.values()].sort((a, b) =>
      b.messages[0].date.localeCompare(a.messages[0].date),
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
    this.decisions[email] = { status: decision, at: new Date().toISOString() };
    writeDecisions(this.userEmail(), this.decisions);

    if (decision === 'approved') {
      // Their mail is already in the inbox; nothing to change in Gmail.
      return;
    }

    // D7 — a Gmail filter keeps future mail out of the inbox and labels it, so
    // it stays findable in Gmail and simply stops appearing in Pigeon.
    const labelId = await this.ensureDeclinedLabel();
    await this.call(`${GMAIL}/settings/filters`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        criteria: { from: email },
        action: { addLabelIds: [labelId], removeLabelIds: ['INBOX'] },
      }),
    }).catch(() => {
      // A duplicate filter is fine; the decision is recorded either way.
    });
  }

  async undecideSender(senderId: string): Promise<void> {
    const email = senderId.toLowerCase();
    const previous = this.decisions[email];
    delete this.decisions[email];
    writeDecisions(this.userEmail(), this.decisions);

    if (previous?.status !== 'declined') return;

    const filters = await this.call<{
      filter?: { id: string; criteria?: { from?: string } }[];
    }>(`${GMAIL}/settings/filters`).catch(() => ({ filter: [] }));

    for (const filter of filters.filter ?? []) {
      if (filter.criteria?.from?.toLowerCase() === email) {
        await this.call(`${GMAIL}/settings/filters/${filter.id}`, { method: 'DELETE' }).catch(
          () => undefined,
        );
      }
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
    const raw = buildRawMessage({
      from: { name: account.name, email: account.email },
      to: draft.to,
      cc: draft.cc,
      bcc: draft.bcc,
      subject: draft.subject,
      body: draft.body,
      attachments: draft.attachments,
    });

    let sent: GmailMessage;
    try {
      sent = await this.call<GmailMessage>(`${GMAIL}/messages/send`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(draft.threadId ? { raw, threadId: draft.threadId } : { raw }),
      });
    } catch {
      throw new MailError(
        "Gmail didn't accept this message. Check the recipient addresses and send again.",
        'send-rejected',
      );
    }

    this.threads.delete(sent.threadId);
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
    // Gmail has no unsend after the fact, and D8 forbids trashing. The message
    // is moved out of the inbox view instead; it stays in the user's Sent mail.
    await this.call(`${GMAIL}/messages/${messageId}/modify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ removeLabelIds: ['INBOX'] }),
    }).catch(() => undefined);
  }

  async search(query: string, includeHeld: boolean): Promise<SearchResults> {
    const q = query.trim();
    if (q.length < 2) return { inbox: [], archive: [], held: [] };

    const list = await this.call<{ threads?: { id: string }[] }>(
      `${GMAIL}/threads?${new URLSearchParams({ q, maxResults: '50' })}`,
    );

    const threads = await Promise.all(
      (list.threads ?? []).map((t) => this.getThread(t.id).catch(() => null)),
    );

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
