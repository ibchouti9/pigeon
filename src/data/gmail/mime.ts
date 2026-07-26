/** Gmail message payloads in, Pigeon domain objects out. */

import type { Address, Attachment, Message } from '../../types';

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

export function decodeBase64Url(data: string): string {
  const normalised = data.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalised.padEnd(Math.ceil(normalised.length / 4) * 4, '=');
  try {
    // atob yields a byte string; run it back through TextDecoder for UTF-8.
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    return new TextDecoder('utf-8').decode(bytes);
  } catch {
    return '';
  }
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
    return { text: decodeBase64Url(part.body.data), html: '' };
  }
  if (part.mimeType === 'text/html' && part.body?.data) {
    return { text: '', html: decodeBase64Url(part.body.data) };
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

/** Last-resort conversion when a message carries no text/plain alternative. */
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
    return {
      body: lines.slice(0, firstQuote).join('\n').trimEnd(),
      quoted: lines.slice(firstQuote).join('\n').trim(),
    };
  }

  return { body: body.trimEnd() };
}

export function toMessage(raw: GmailMessage, userEmail: string): Message {
  const headers = raw.payload?.headers;
  const from = parseAddressList(header(headers, 'From'))[0] ?? { name: '', email: '' };
  const found = findBody(raw.payload);
  const text = found.text || (found.html ? htmlToText(found.html) : (raw.snippet ?? ''));
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
    attachments: collectAttachments(raw.payload),
    isFromUser: from.email.toLowerCase() === userEmail.toLowerCase(),
  };
}

function encodeHeaderValue(value: string): string {
  // RFC 2047 for anything outside ASCII, so names with accents survive.
  // eslint-disable-next-line no-control-regex
  return /^[\x00-\x7F]*$/.test(value) ? value : `=?UTF-8?B?${btoa(unescape(encodeURIComponent(value)))}?=`;
}

function formatAddress(a: Address): string {
  return a.name ? `${encodeHeaderValue(a.name)} <${a.email}>` : a.email;
}

/** Builds the RFC 5322 message Gmail's send endpoint expects. */
export function buildRawMessage(input: {
  from: Address;
  to: Address[];
  cc: Address[];
  bcc: Address[];
  subject: string;
  body: string;
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
  lines.push('Content-Type: text/plain; charset="UTF-8"');
  lines.push('Content-Transfer-Encoding: 8bit');
  lines.push('');
  lines.push(input.body);

  return encodeBase64Url(lines.join('\r\n'));
}
