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
  unread: boolean;
  messageCount: number;
  lastUid: number;
}

export interface BridgeListPage {
  threads: BridgeStub[];
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
