/** Domain model for Pigeon. Shared by every data provider (mock and Gmail). */

export interface Address {
  name: string;
  email: string;
}

export interface Attachment {
  id: string;
  filename: string;
  /** Bytes. */
  size: number;
  mimeType: string;
}

/**
 * A file chosen in the composer, held in memory until the message is sent.
 * D20 caps these at 25 MB; nothing is uploaded anywhere before send.
 */
export interface OutgoingAttachment {
  id: string;
  filename: string;
  size: number;
  mimeType: string;
  /** base64, without the data: prefix. */
  data: string;
}

export interface Message {
  id: string;
  threadId: string;
  from: Address;
  to: Address[];
  cc: Address[];
  subject: string;
  /**
   * The message as text. Still the canonical body: previews, search, the lane
   * classifier and every AI prompt read this, and none of them wants markup.
   */
  body: string;
  /**
   * The message as the sender wrote it, when it was written in HTML.
   *
   * Rendered by C-8 inside a sandboxed frame with its own CSP — see
   * `data/sanitize.ts` for why that is three layers rather than one. Absent
   * for a plain-text message, which is most personal mail.
   */
  bodyHtml?: string;
  /** Quoted history, split off from `body` so it can collapse (§5.6). */
  quoted?: string;
  /** ISO 8601. */
  date: string;
  attachments: Attachment[];
  isFromUser: boolean;
  /**
   * The RFC 5322 `Message-ID` header. Gmail threads a reply on `In-Reply-To`
   * and `References`, not on `threadId` alone — without this there is nothing
   * to build those from and every reply starts its own thread.
   */
  messageId?: string;
  /**
   * Whether the message carries `List-Unsubscribe`.
   *
   * `LaneSignals` has read this since the classifier was written, from a field
   * no provider ever set — so the strongest evidence a lane has was
   * permanently absent and the sort ran on body regexes alone.
   */
  listUnsubscribe?: boolean;
}

/** Where a thread lives. Every thread is in exactly one place (§2.1). */
export type Place = 'inbox' | 'archive';

export interface Thread {
  id: string;
  subject: string;
  place: Place;
  unread: boolean;
  messages: Message[];
  /** ISO 8601 of the newest message. */
  lastMessageAt: string;
  /**
   * ISO 8601 of the oldest message. §2.3's rules are about the conversation
   * rather than its latest reply, so "when did this start" is a question the
   * decision machine asks — and a `preview` thread does not hold the messages
   * to derive it from. Absent on threads built before this existed, where
   * `startedAt` falls back to reducing the messages.
   */
  firstMessageAt?: string;
  /**
   * How many messages the conversation holds. Carried separately because a
   * `preview` row holds one synthetic message and would otherwise report every
   * conversation as one message long. Absent means `messages.length` is the
   * count, which is true of every fully fetched thread.
   */
  messageCount?: number;
  /**
   * A listing's row, not a conversation: sender, subject and a preview line
   * from the engine's cheap pass, carried as one synthetic message. Opening the
   * thread replaces it with the real one.
   *
   * Every screen that shows a body has to tolerate this. A 40,000-thread
   * mailbox is why: hydrating every conversation to render a list of names cost
   * five round trips and every byte of every message, per row.
   */
  preview?: boolean;
  /** Set when this is the first thread since the sender was approved (§4.2 #4). */
  approvedAt?: string;
}

export type SenderStatus = 'unknown' | 'approved' | 'declined';

/** Why Pigeon proposed this sender as already-known (D10). */
export type KnownReason = 'contact' | 'replies';

export interface Sender {
  id: string;
  name: string;
  email: string;
  status: SenderStatus;
  /** ISO 8601 of the approve/decline decision. Drives the postmark date. */
  decidedAt?: string;
  knownReason?: KnownReason;
  /** How many messages the user has sent this address (D10). */
  replyCount?: number;
}

/** A sender waiting in the Screener, with everything held from them. */
export interface HeldSender {
  sender: Sender;
  messages: Message[];
}


export interface Account {
  email: string;
  name: string;
  /** ISO 8601. */
  connectedAt: string;
}

export interface SyncProgress {
  /** Null until the total is known — renders "Counting your threads" (§5.2b). */
  total: number | null;
  done: number;
  step: 'connect' | 'contacts' | 'history' | 'senders' | 'complete';
  error?: string;
}

export interface Draft {
  id: string;
  to: Address[];
  cc: Address[];
  bcc: Address[];
  subject: string;
  body: string;
  /** Set for replies and forwards. */
  threadId?: string;
  mode: 'new' | 'reply' | 'reply-all' | 'forward';
  attachments: OutgoingAttachment[];
  /** Ownership of the body text (§4.7). */
  aiState: 'none' | 'generating' | 'drafted' | 'edited';
}
