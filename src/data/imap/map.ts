import type { Message, Thread } from '../../types';
import { htmlToText, splitQuoted } from '../mime';
import type { BridgeMessage, BridgeThread } from './bridge';

/**
 * Bridge JSON → Pigeon's domain. Rust hands over what the wire said — text
 * and html side by side, dates from the server's clock — and this applies the
 * product's reading rules, which predate IMAP and are tested where they live:
 * prefer text, flatten html (§5.9 renders text, never remote HTML), split the
 * quoted history off the top (§5.6).
 */
function mapMessage(raw: BridgeMessage, userEmail: string): Message {
  const flat = raw.text ?? (raw.html ? htmlToText(raw.html) : '');
  const split = splitQuoted(flat);

  return {
    id: raw.id,
    threadId: '', // the caller stamps the thread's id; a message never moves
    subject: raw.subject,
    from: raw.from,
    to: raw.to,
    cc: raw.cc,
    body: split.body,
    quoted: split.quoted,
    date: raw.date,
    attachments: raw.attachments.map((a) => ({
      // downloadAttachment gets (messageId, attachmentId) and nothing else,
      // so the id carries what the engine needs: which message, which part.
      id: `${raw.uid}/${a.id}`,
      filename: a.filename,
      size: a.size,
      mimeType: a.mimeType,
    })),
    /*
     * Gmail's own verdict first, the address only as a fallback. Real accounts
     * send from aliases, `+` addressing and "send mail as" identities, and the
     * connected address is only the primary — matching on it alone once read
     * the user's own alias-sent mail as incoming, which put *the user* in
     * their own Screener as an unknown sender.
     */
    isFromUser: raw.fromUser || raw.from.email.toLowerCase() === userEmail.toLowerCase(),
    messageId: raw.messageId ?? undefined,
  };
}

export function mapThread(raw: BridgeThread, userEmail: string): Thread {
  const messages = raw.messages.map((m) => ({
    ...mapMessage(m, userEmail),
    threadId: raw.id,
  }));
  return {
    id: raw.id,
    subject: raw.subject || '(no subject)',
    place: raw.inInbox ? 'inbox' : 'archive',
    unread: raw.unread,
    messages,
    lastMessageAt: raw.lastMessageAt,
  };
}
