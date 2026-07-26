/** Gmail message payloads in, Pigeon domain objects out. */

import type { Address, Attachment, Message, OutgoingAttachment } from '../../types';

export interface GmailHeader {
  name: string;
  value: string;
}

export interface GmailPart {
  partId?: string;
  mimeType?: string;
  filename?: string;
  headers?: GmailHeader[];
  body?: { size?: number; data?: string; attachmentId?: string };
  parts?: GmailPart[];
}

export interface GmailMessage {
  id: string;
  threadId: string;
  labelIds?: string[];
  snippet?: string;
  internalDate?: string;
  payload?: GmailPart;
}

export function decodeBase64Url(data: string, charset = 'utf-8'): string {
  const normalised = data.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalised.padEnd(Math.ceil(normalised.length / 4) * 4, '=');
  try {
    // atob yields a byte string; run it back through a decoder for the part's
    // own charset. Gmail decodes the transfer encoding and leaves the character
    // set alone, so assuming UTF-8 rendered every windows-1252 or Shift_JIS
    // message as a field of replacement characters — which is most mail from
    // mailing lists and older senders.
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    try {
      return new TextDecoder(charset).decode(bytes);
    } catch {
      // An unknown label is not a reason to lose the message.
      return new TextDecoder('utf-8').decode(bytes);
    }
  } catch {
    return '';
  }
}

/** The `charset` parameter off a part's own Content-Type, if it declared one. */
function charsetOf(part: GmailPart): string | undefined {
  const contentType = header(part.headers, 'Content-Type');
  return contentType.match(/charset=\s*"?([^";\s]+)"?/i)?.[1];
}

export function encodeBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function header(headers: GmailHeader[] | undefined, name: string): string {
  return headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? '';
}

/**
 * Splits on commas that separate addresses, ignoring commas inside a quoted
 * display name or inside angle brackets. A regex can't see quoting state, and
 * `"Whitlock, Dana" <dana@lumen.com>` is common enough to matter.
 */
function splitAddressList(value: string): string[] {
  const entries: string[] = [];
  let current = '';
  let inQuotes = false;
  let inAngle = false;

  for (let i = 0; i < value.length; i++) {
    const char = value[i];
    if (char === '"' && value[i - 1] !== '\\') {
      inQuotes = !inQuotes;
    } else if (!inQuotes && char === '<') {
      inAngle = true;
    } else if (!inQuotes && char === '>') {
      inAngle = false;
    } else if (char === ',' && !inQuotes && !inAngle) {
      entries.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  entries.push(current);

  return entries.map((e) => e.trim()).filter(Boolean);
}

/** `Dana Whitlock <dana@lumen.com>, sana@northbound.io` → two addresses. */
export function parseAddressList(value: string): Address[] {
  if (!value.trim()) return [];
  return splitAddressList(value).map((entry) => {
    const match = entry.match(/^(.*?)\s*<([^>]+)>$/);
    if (match) {
      return { name: match[1].replace(/^"|"$/g, '').trim(), email: match[2].trim() };
    }
    return { name: '', email: entry.replace(/^"|"$/g, '') };
  });
}

/**
 * Walks the MIME tree for the best plain-text body. Pigeon renders text, never
 * remote HTML — that is what makes blocking images in the Screener meaningful.
 */
function findBody(part: GmailPart | undefined): { text: string; html: string } {
  if (!part) return { text: '', html: '' };

  if (part.mimeType === 'text/plain' && part.body?.data) {
    return { text: decodeBase64Url(part.body.data, charsetOf(part)), html: '' };
  }
  if (part.mimeType === 'text/html' && part.body?.data) {
    return { text: '', html: decodeBase64Url(part.body.data, charsetOf(part)) };
  }

  let text = '';
  let html = '';
  for (const child of part.parts ?? []) {
    const found = findBody(child);
    if (!text && found.text) text = found.text;
    if (!html && found.html) html = found.html;
  }
  return { text, html };
}

function unescapeHtml(value: string): string {
  if (!value.includes('&')) return value;
  const doc = new DOMParser().parseFromString(value, 'text/html');
  return doc.body?.textContent ?? value;
}

/** Last-resort conversion when a message carries no text/plain alternative. */
/** HTML mail, flattened to the text Pigeon renders (§5.9: never remote HTML). */
export function htmlToText(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('script, style, head').forEach((el) => el.remove());
  return (doc.body?.textContent ?? '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function collectAttachments(part: GmailPart | undefined, out: Attachment[] = []): Attachment[] {
  if (!part) return out;
  if (part.filename && part.body?.attachmentId) {
    out.push({
      id: part.body.attachmentId,
      filename: part.filename,
      size: part.body.size ?? 0,
      mimeType: part.mimeType ?? 'application/octet-stream',
    });
  }
  for (const child of part.parts ?? []) collectAttachments(child, out);
  return out;
}

/** Splits a reply's quoted history off the top-level body (§5.6). */
export function splitQuoted(body: string): { body: string; quoted?: string } {
  const lines = body.split('\n');
  const markers = [
    /^On .+ wrote:\s*$/,
    /^-{2,}\s*Original Message\s*-{2,}/i,
    /^_{5,}\s*$/,
    /^From:\s.+/,
  ];

  for (let i = 0; i < lines.length; i++) {
    if (markers.some((m) => m.test(lines[i].trim()))) {
      return {
        body: lines.slice(0, i).join('\n').trimEnd(),
        quoted: lines.slice(i).join('\n').trim(),
      };
    }
  }

  const firstQuote = lines.findIndex((l) => l.startsWith('>'));
  if (firstQuote > 0) {
    /*
     * Cut above the attribution, not below it. The markers above want the whole
     * of "On Mon, 20 Jul 2026 at 16:12 Dana Whitlock <dana@lumen.com> wrote:"
     * on one line, and Gmail wraps it for any reasonably long name or date —
     * so the fallback fired instead and left the attribution sitting in the
     * visible body of essentially every threaded reply. Non-English clients
     * ("Le … a écrit :", "Am … schrieb:") never matched a marker at all, and
     * this catches them by shape rather than by language.
     */
    // The contiguous non-empty run directly above the quote, at most three
    // lines — which is as long as a wrapped attribution ever gets.
    let top = firstQuote;
    while (top > 0 && lines[top - 1].trim() !== '' && firstQuote - top < 3) top -= 1;

    const cut = top < firstQuote && isAttribution(lines.slice(top, firstQuote))
      ? top
      : firstQuote;

    return {
      body: lines.slice(0, cut).join('\n').trimEnd(),
      quoted: lines.slice(cut).join('\n').trim(),
    };
  }

  return { body: body.trimEnd() };
}

/**
 * Does this run of lines end in an attribution? Shape rather than wording: an
 * address or a date, ending in a colon, within the last few lines before the
 * quote. That covers Gmail's wrapped English form and the common translations
 * without keeping a list of languages.
 */
function isAttribution(block: string[]): boolean {
  const joined = block.map((l) => l.trim()).filter(Boolean).join(' ');
  if (!joined || !/[:：]\s*$/.test(joined)) return false;
  return /@|\d{4}|\d{1,2}:\d{2}/.test(joined);
}

export function toMessage(raw: GmailMessage, userEmail: string): Message {
  const headers = raw.payload?.headers;
  const from = parseAddressList(header(headers, 'From'))[0] ?? { name: '', email: '' };
  const found = findBody(raw.payload);
  // Gmail's snippet is HTML-escaped, so as plain text it reads "Don&#39;t
  // forget". It is only reached when a message carries neither a text nor an
  // HTML part, but that is exactly when it is all the user has.
  const text =
    found.text || (found.html ? htmlToText(found.html) : unescapeHtml(raw.snippet ?? ''));
  const split = splitQuoted(text);

  return {
    id: raw.id,
    threadId: raw.threadId,
    from,
    to: parseAddressList(header(headers, 'To')),
    cc: parseAddressList(header(headers, 'Cc')),
    subject: header(headers, 'Subject'),
    body: split.body,
    quoted: split.quoted,
    date: new Date(Number(raw.internalDate ?? Date.now())).toISOString(),
    messageId: header(headers, 'Message-ID') || undefined,
    attachments: collectAttachments(raw.payload),
    /*
     * Gmail's own SENT label first, the address only as a fallback. Real
     * accounts send from aliases, `+` addressing and Workspace "send mail as"
     * identities, and `users/me/profile` only ever reports the primary — so
     * matching on the address alone read the user's own alias-sent mail as
     * incoming. That put *the user* in their own Screener as an unknown sender,
     * and hid the threads they had started from their inbox.
     */
    isFromUser:
      raw.labelIds?.includes('SENT') === true ||
      from.email.toLowerCase() === userEmail.toLowerCase(),
  };
}

function encodeHeaderValue(value: string): string {
  // RFC 2047 for anything outside ASCII, so names with accents survive.
  // eslint-disable-next-line no-control-regex
  return /^[\x00-\x7F]*$/.test(value) ? value : `=?UTF-8?B?${btoa(unescape(encodeURIComponent(value)))}?=`;
}

/**
 * RFC 5322 needs a display name containing any "special" to be a quoted-string.
 * Emitting it bare turned `Whitlock, Dana <dana@lumen.com>` into two addresses,
 * `Whitlock` and `Dana <dana@lumen.com>` — and "Last, First" is exactly how
 * Google Contacts hands names back. `splitAddressList` above already goes to
 * some trouble to read that form on the way in; this is the other half.
 */
function formatAddress(a: Address): string {
  // `people/me` can fail, and the account name then falls back to the address —
  // which would put `marc@x.dev <marc@x.dev>` in every From header.
  if (!a.name || a.name.toLowerCase() === a.email.toLowerCase()) return a.email;
  const encoded = encodeHeaderValue(a.name);
  // An RFC 2047 encoded-word is already a token and must not be quoted.
  if (encoded !== a.name) return `${encoded} <${a.email}>`;
  const needsQuoting = /[(),.:;<>@[\]\\"]/.test(a.name);
  const display = needsQuoting ? `"${a.name.replace(/(["\\])/g, '\\$1')}"` : a.name;
  return `${display} <${a.email}>`;
}

/**
 * RFC 2231 for a filename outside ASCII. Headers are 7-bit, so a name like
 * `Réunion.pdf` used to put raw UTF-8 octets into one — illegal, and the first
 * attachment anyone outside an ASCII locale sent would have arrived as
 * `noname` or mojibake. A `"` in the name broke the quoted-string outright.
 */
function filenameParams(filename: string): string {
  // eslint-disable-next-line no-control-regex
  if (/^[\x20-\x7E]*$/.test(filename) && !/["\\]/.test(filename)) {
    return `filename="${filename}"`;
  }
  return `filename*=UTF-8''${encodeURIComponent(filename)}`;
}

/**
 * The body as separate lines, so `join('\r\n')` gives it the line endings RFC
 * 5322 asks for. Pushed as one string, its own `\n` breaks went out unchanged.
 */
function bodyLines(body: string): string[] {
  return body.replace(/\r\n/g, '\n').split('\n');
}

/** Wraps base64 at 76 characters, as RFC 2045 requires. */
function wrapBase64(data: string): string {
  return (data.match(/.{1,76}/g) ?? []).join('\r\n');
}

/** Builds the RFC 5322 message Gmail's send endpoint expects. */
export function buildRawMessage(input: {
  from: Address;
  to: Address[];
  cc: Address[];
  bcc: Address[];
  subject: string;
  body: string;
  attachments?: OutgoingAttachment[];
  inReplyTo?: string;
  references?: string;
}): string {
  const lines = [
    `From: ${formatAddress(input.from)}`,
    `To: ${input.to.map(formatAddress).join(', ')}`,
  ];
  if (input.cc.length) lines.push(`Cc: ${input.cc.map(formatAddress).join(', ')}`);
  if (input.bcc.length) lines.push(`Bcc: ${input.bcc.map(formatAddress).join(', ')}`);
  lines.push(`Subject: ${encodeHeaderValue(input.subject)}`);
  if (input.inReplyTo) lines.push(`In-Reply-To: ${input.inReplyTo}`);
  if (input.references) lines.push(`References: ${input.references}`);
  lines.push('MIME-Version: 1.0');

  const attachments = input.attachments ?? [];

  if (attachments.length === 0) {
      lines.push('Content-Type: text/plain; charset="UTF-8"');
    lines.push('Content-Transfer-Encoding: 8bit');
    lines.push('');
    lines.push(...bodyLines(input.body));
    return encodeBase64Url(lines.join('\r\n'));
  }

  // Fixed boundary token: it only has to be absent from the parts, and the
  // parts are either UTF-8 text or base64, neither of which can contain it.
  const boundary = `----pigeon-${attachments.length}-${input.subject.length}-boundary`;

  lines.push(`Content-Type: multipart/mixed; boundary="${boundary}"`);
  lines.push('');
  lines.push(`--${boundary}`);
  lines.push('Content-Type: text/plain; charset="UTF-8"');
  lines.push('Content-Transfer-Encoding: 8bit');
  lines.push('');
  lines.push(...bodyLines(input.body));

  for (const file of attachments) {
    lines.push('');
    lines.push(`--${boundary}`);
    lines.push(`Content-Type: ${file.mimeType}`);
    lines.push(`Content-Disposition: attachment; ${filenameParams(file.filename)}`);
    lines.push('Content-Transfer-Encoding: base64');
    lines.push('');
    lines.push(wrapBase64(file.data));
  }

  lines.push('');
  lines.push(`--${boundary}--`);

  return encodeBase64Url(lines.join('\r\n'));
}
