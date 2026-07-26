/**
 * The JSON shapes the Rust mail engine emits, mirrored by hand from
 * `src-tauri/src/mail/types.rs`. Two declarations of one truth across a
 * language boundary: if one changes, change the other.
 */

export interface BridgeAddress {
  name: string;
  email: string;
}

export interface BridgeAttachment {
  /** MIME part index within its message, as a string. */
  id: string;
  filename: string;
  size: number;
  mimeType: string;
}

export interface BridgeMessage {
  /** X-GM-MSGID when Gmail provides it, else the UID. */
  id: string;
  uid: number;
  subject: string;
  from: BridgeAddress;
  to: BridgeAddress[];
  cc: BridgeAddress[];
  /** ISO 8601, from INTERNALDATE. */
  date: string;
  text: string | null;
  html: string | null;
  attachments: BridgeAttachment[];
  messageId: string | null;
  unread: boolean;
  /** Gmail says this is the user's own send (`in:sent` membership). */
  fromUser: boolean;
}

export interface BridgeThread {
  id: string;
  subject: string;
  inInbox: boolean;
  unread: boolean;
  lastMessageAt: string;
  messages: BridgeMessage[];
}

export interface BridgeStub {
  id: string;
  lastMessageAt: string;
  /** When the conversation started — the date §2.3's rules are about. */
  firstMessageAt: string;
  unread: boolean;
  messageCount: number;
  /** §2.1's one place, decided the same way `BridgeThread.inInbox` decides it. */
  inInbox: boolean;
  lastUid: number;
  /** The newest message that isn't the user's own send. */
  previewUid: number;
  /** True when the thread holds nothing incoming at all. */
  fromUser: boolean;
  /**
   * Everything below is filled by the engine's enrichment pass, for the window
   * being listed. Absent means "not asked for yet", not "empty".
   */
  from: BridgeAddress | null;
  subject: string | null;
  snippetText: string | null;
  snippetHtml: string | null;
}

export interface BridgeListPage {
  /** The requested window, newest first. */
  threads: BridgeStub[];
  /** Every thread the query matches, not the size of this page. */
  total: number;
}

export interface BridgeSentRecipient {
  name: string;
  email: string;
  count: number;
}

export interface BridgeMailStatus {
  connected: boolean;
  email: string | null;
}
