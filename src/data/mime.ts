/**
 * MIME, both directions: reading rules for message bodies, and the RFC 2822
 * builder every outgoing message goes through. Transport-neutral — the Rust
 * engine parses the wire format and hands bodies over; this file owns what
 * Pigeon shows and what it sends.
 */

import type { Address, OutgoingAttachment } from '../types';

function encodeBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Elements that start and end a line when HTML is flattened. `textContent`
 * knows about none of them, which is what ran every paragraph of a newsletter
 * into one another.
 */
const BLOCK = new Set([
  'ADDRESS', 'ARTICLE', 'ASIDE', 'BLOCKQUOTE', 'DD', 'DIV', 'DL', 'DT',
  'FIELDSET', 'FIGCAPTION', 'FIGURE', 'FOOTER', 'FORM', 'H1', 'H2', 'H3',
  'H4', 'H5', 'H6', 'HEADER', 'HR', 'LI', 'MAIN', 'NAV', 'OL', 'P',
  'SECTION', 'TABLE', 'TR', 'UL',
]);

/** Links worth keeping. `#anchor` and `javascript:` carry nothing here. */
function isReachable(href: string): boolean {
  return /^(https?:\/\/|mailto:)/i.test(href);
}

/**
 * HTML mail, flattened to the text Pigeon renders (§5.9: never remote HTML).
 *
 * This used to be `body.textContent`, which throws away two things a reader
 * needs. Structure was one: block elements have no text of their own, so
 * "Hi Ibrahim," and the paragraph after it came out welded together, and a
 * list became "Item oneItem two".
 *
 * The destinations were the other, and worse. Every `href` was discarded, so
 * an HTML-only password reset flattened to the words "Reset your password"
 * with nothing behind them — the mail Pigeon has to handle *best*, because a
 * transactional sender is exactly who never sends a text/plain alternative,
 * arrived unusable. The URL is appended in parentheses after the link text so
 * it survives as text and `linkifyBody` can make it clickable again.
 */
export function htmlToText(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('script, style, head, noscript').forEach((el) => el.remove());

  let out = '';
  /*
   * <pre> is held out of the whitespace pass below and put back afterwards.
   * Its indentation is the content, and the pass exists to destroy exactly
   * that kind of whitespace everywhere else.
   */
  const preserved: string[] = [];

  /**
   * One newline between blocks, never two. Mail wraps each visual line in its
   * own `<div>`, so emitting a break on both the open and the close tag
   * double-spaces an entire message. `<br>` is separate and does stack, which
   * is how a deliberate blank line survives.
   */
  function boundary(): void {
    if (out && !out.endsWith('\n')) out += '\n';
  }

  function walk(node: Node): void {
    if (node.nodeType === 3 /* TEXT_NODE */) {
      // HTML collapses runs of whitespace and `textContent` does not, so the
      // source's own indentation would otherwise arrive as gaps in the body.
      out += (node.textContent ?? '').replace(/\s+/g, ' ');
      return;
    }
    if (node.nodeType !== 1 /* ELEMENT_NODE */) return;

    const el = node as Element;
    const tag = el.tagName;

    if (tag === 'BR') {
      out += '\n';
      return;
    }
    if (tag === 'PRE') {
      boundary();
      // A Private Use codepoint delimits the placeholder: nothing in real mail
      // contains one, so it cannot collide with what a message actually says.
      // A bare number could, and would corrupt the body it turned up in.
      out += `\uE000${preserved.push(el.textContent ?? '') - 1}\uE000\n`;
      return;
    }

    if (BLOCK.has(tag)) boundary();
    if (tag === 'LI') out += '- ';

    for (const child of Array.from(el.childNodes)) walk(child);

    if (tag === 'A') {
      const href = el.getAttribute('href') ?? '';
      const text = (el.textContent ?? '').replace(/\s+/g, ' ').trim();
      // A link whose text is already its own URL needs no second copy.
      if (isReachable(href) && !text.includes(href)) out += ` (${href})`;
    }

    if (BLOCK.has(tag)) boundary();
    // Cells are a layout device in mail, not a table — keep them on one line.
    if (tag === 'TD' || tag === 'TH') out += ' ';
  }

  walk(doc.body ?? doc);

  return out
    .replace(/[^\S\n]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .replace(/\uE000(\d+)\uE000/g, (_, i: string) => preserved[Number(i)]);
}

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
};

/**
 * Plain text promoted to the markup the editor edits.
 *
 * Pigeon writes text, not HTML — a drafted reply, a tone change, a forward's
 * quoted history — so anything it produces has to be promoted before it
 * reaches a `contenteditable`, or the editor would render the angle brackets
 * of a quoted line as tags. One paragraph per blank-line-separated block,
 * which is what `htmlToText` turns back into the same blank lines.
 */
export function textToHtml(text: string): string {
  if (!text.trim()) return '';
  return text
    .split(/\n{2,}/)
    .map((block) => {
      const escaped = block.replace(/[&<>]/g, (c) => HTML_ESCAPES[c]);
      return `<p>${escaped.replace(/\n/g, '<br>')}</p>`;
    })
    .join('');
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
  /** The rich half, when the composer produced one. Sent alongside the text. */
  bodyHtml?: string;
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
  const html = input.bodyHtml?.trim();

  /*
   * The plain-text half is always sent, and it is not a courtesy.
   *
   * `text/plain` is what a screen reader, a terminal client, a notification
   * preview and every downstream search index read — and it is what Pigeon
   * itself reads back, since `Message.body` is the canonical body for search,
   * the lane classifier and every AI prompt. A message that arrives as HTML
   * alone is a message those cannot see. RFC 2046 puts the plainest
   * alternative first and the richest last; clients show the last they can
   * render.
   */
  const bodyPart = (): string[] => {
    if (!html) {
      return [
        'Content-Type: text/plain; charset="UTF-8"',
        'Content-Transfer-Encoding: 8bit',
        '',
        ...bodyLines(input.body),
      ];
    }
    const alt = `----pigeon-alt-${input.body.length}-${html.length}-boundary`;
    return [
      `Content-Type: multipart/alternative; boundary="${alt}"`,
      '',
      `--${alt}`,
      'Content-Type: text/plain; charset="UTF-8"',
      'Content-Transfer-Encoding: 8bit',
      '',
      ...bodyLines(input.body),
      '',
      `--${alt}`,
      'Content-Type: text/html; charset="UTF-8"',
      'Content-Transfer-Encoding: 8bit',
      '',
      ...bodyLines(html),
      '',
      `--${alt}--`,
    ];
  };

  if (attachments.length === 0) {
    lines.push(...bodyPart());
    return encodeBase64Url(lines.join('\r\n'));
  }

  // Fixed boundary token: it only has to be absent from the parts, and the
  // parts are either UTF-8 text or base64, neither of which can contain it.
  const boundary = `----pigeon-${attachments.length}-${input.subject.length}-boundary`;

  lines.push(`Content-Type: multipart/mixed; boundary="${boundary}"`);
  lines.push('');
  lines.push(`--${boundary}`);
  lines.push(...bodyPart());

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
