import type {
  Account,
  Address,
  HeldSender,
  Message,
  Sender,
  SyncProgress,
  Thread,
} from '../types';

/**
 * Everything Pigeon needs from a mail backend.
 *
 * Two implementations ship: `MockMailProvider` (a seeded demo account, used by
 * the demo build and every test) and `GmailMailProvider` (the real Gmail REST
 * API). Nothing above this interface knows which one it is talking to.
 */
export interface MailProvider {
  readonly kind: 'mock' | 'gmail';

  getAccount(): Promise<Account>;

  /** Streams sync progress during onboarding (§5.2b). Resolves when complete. */
  sync(onProgress: (p: SyncProgress) => void): Promise<void>;

  /** Senders Pigeon proposes as already-known, for O4 (D10). */
  getKnownSenders(): Promise<Sender[]>;

  /** Records the O4 decision: everything ticked becomes approved. */
  approveKnownSenders(senderIds: string[]): Promise<void>;

  listThreads(place: 'inbox' | 'archive'): Promise<Thread[]>;
  getThread(threadId: string): Promise<Thread>;
  markRead(threadId: string, read: boolean): Promise<void>;

  /** Archive is the only removal action (D8). */
  setPlace(threadId: string, place: 'inbox' | 'archive'): Promise<void>;

  listHeld(): Promise<HeldSender[]>;

  /**
   * Approving moves every held message from that sender into the Inbox, marked
   * unread, with today's date (§2.3). Declining silences, never deletes (D7).
   */
  decideSender(senderId: string, decision: 'approved' | 'declined'): Promise<void>;

  /** Reverses a decision. A reversed decline surfaces no old mail (§2.3). */
  undecideSender(senderId: string): Promise<void>;

  listSenders(status: 'approved' | 'declined'): Promise<Sender[]>;

  /** Autocomplete source: approved senders plus contacts (§3.5 step 2). */
  listContacts(): Promise<Address[]>;

  send(draft: {
    to: Address[];
    cc: Address[];
    bcc: Address[];
    subject: string;
    body: string;
    threadId?: string;
  }): Promise<Message>;

  /** Un-appends a sent message during the 8s undo window (§3.4 step 6). */
  unsend(messageId: string): Promise<void>;

  /** Covers Inbox and Archive; held is opt-in (D12). */
  search(query: string, includeHeld: boolean): Promise<SearchResults>;
}

export interface SearchResults {
  inbox: Thread[];
  archive: Thread[];
  held: HeldSender[];
}

export type MailErrorCode =
  | 'unreachable'
  | 'revoked'
  | 'not-found'
  | 'send-rejected'
  | 'unknown';

/** Thrown for anything the UI must render as an error state from §7.6. */
export class MailError extends Error {
  readonly code: MailErrorCode;

  constructor(message: string, code: MailErrorCode = 'unknown') {
    super(message);
    this.name = 'MailError';
    this.code = code;
  }
}
