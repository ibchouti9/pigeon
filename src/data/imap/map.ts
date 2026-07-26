import type { Message, Thread } from '../../types';
import { htmlToText, splitQuoted } from '../mime';
import type { BridgeMessage, BridgeStub, BridgeThread } from './bridge';

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
    firstMessageAt: messages.reduce(
      (earliest, m) => (m.date && m.date < earliest ? m.date : earliest),
      raw.lastMessageAt,
    ),
  };
}

/**
 * One listing row as a `Thread`, out of the engine's cheap pass.
 *
 * The row is a whole conversation's worth of what a list shows — who, what,
 * when, how many, and a preview line — and none of its bodies. It is modelled
 * as a `Thread` holding one synthetic message rather than as a separate type,
 * because §2.3's rules, the list, the row and the sorting are all written
 * against `Thread` and they are all still exactly right here: the one thing
 * that changes is that the bodies aren't there yet.
 *
 * `preview: true` is how a caller knows. `getThread` replaces the whole object
 * the moment someone opens it.
 */
export function mapStub(raw: BridgeStub): Thread {
  const place = raw.inInbox ? 'inbox' : 'archive';
  const flat = raw.snippetText ?? (raw.snippetHtml ? htmlToText(raw.snippetHtml) : '');
  // The same quoted-history split a real body gets (§5.6) — a preview line
  // should not open with "On Monday, Dana wrote:" either.
  const { body } = splitQuoted(flat);
  const subject = raw.subject || '(no subject)';

  return {
    id: raw.id,
    subject,
    place,
    unread: raw.unread,
    lastMessageAt: raw.lastMessageAt,
    firstMessageAt: raw.firstMessageAt || raw.lastMessageAt,
    messageCount: raw.messageCount,
    preview: true,
    messages: [
      {
        // Not the real message's id: the engine hands over a UID for the
        // *preview*, and minting an id that looks like a message's invites
        // something to act on it. Anything that acts works on the thread.
        id: `preview-${raw.id}`,
        threadId: raw.id,
        subject,
        from: raw.from ?? { name: '', email: '' },
        to: [],
        cc: [],
        body,
        date: raw.lastMessageAt,
        // A stub's 2 KB says nothing reliable about attachments, and claiming
        // a paperclip that isn't there is worse than omitting one that is.
        attachments: [],
        isFromUser: raw.fromUser,
      },
    ],
  };
}
