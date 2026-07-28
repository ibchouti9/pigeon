import { describe, expect, it } from 'vitest';
import { buildRawMessage, htmlToText, splitQuoted, textToHtml } from '../mime';

/**
 * Decodes what `buildRawMessage` emits (base64url, UTF-8), so the assertions
 * below can read the message they are about. Test-side only: the product
 * stopped *reading* base64url when the Gmail REST transport went away, but it
 * still writes it, because mime.ts predates the move and the mailer converts.
 */
function decodeBase64Url(data: string): string {
  const normalised = data.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalised.padEnd(Math.ceil(normalised.length / 4) * 4, '=');
  const binary = atob(padded);
  return new TextDecoder('utf-8').decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)));
}

describe('splitQuoted', () => {
  it('splits on an "On … wrote:" attribution line', () => {
    const result = splitQuoted('Thanks, that works.\n\nOn Tue, Dana wrote:\n> the original');
    expect(result.body).toBe('Thanks, that works.');
    expect(result.quoted).toContain('> the original');
  });

  it('splits on a leading quote marker when there is no attribution', () => {
    const result = splitQuoted('Agreed.\n> earlier text');
    expect(result.body).toBe('Agreed.');
    expect(result.quoted).toBe('> earlier text');
  });

  it('leaves an unquoted body whole', () => {
    expect(splitQuoted('Just one line.').quoted).toBeUndefined();
  });
});

describe('buildRawMessage', () => {
  it('produces a decodable RFC 5322 message', () => {
    const raw = buildRawMessage({
      from: { name: 'Marc Ferrum', email: 'marc@ferrum.dev' },
      to: [{ name: 'Dana Whitlock', email: 'dana@lumenpartners.com' }],
      cc: [],
      bcc: [],
      subject: 'Re: Contract redlines',
      body: 'Happy with 750 as a middle.',
    });
    const decoded = decodeBase64Url(raw);
    expect(decoded).toContain('From: Marc Ferrum <marc@ferrum.dev>');
    expect(decoded).toContain('To: Dana Whitlock <dana@lumenpartners.com>');
    expect(decoded).toContain('Subject: Re: Contract redlines');
    expect(decoded).toContain('Happy with 750 as a middle.');
    expect(decoded).not.toContain('Cc:');
  });

  it('RFC 2047-encodes a non-ASCII display name', () => {
    const raw = buildRawMessage({
      from: { name: 'Inês Carvalho', email: 'ines@carvalho-arq.pt' },
      to: [{ name: '', email: 'marc@ferrum.dev' }],
      cc: [],
      bcc: [],
      subject: 'Plantas',
      body: 'Olá',
    });
    expect(decodeBase64Url(raw)).toContain('=?UTF-8?B?');
  });

  it('wraps the body and files in multipart/mixed when attaching (D20)', () => {
    const raw = buildRawMessage({
      from: { name: 'Marc Ferrum', email: 'marc@ferrum.dev' },
      to: [{ name: '', email: 'dana@lumenpartners.com' }],
      cc: [],
      bcc: [],
      subject: 'Redlines',
      body: 'Attached.',
      attachments: [
        {
          id: 'a1',
          filename: 'contract-v3.pdf',
          size: 9,
          mimeType: 'application/pdf',
          data: btoa('some bytes'),
        },
      ],
    });

    const decoded = decodeBase64Url(raw);
    const boundary = decoded.match(/boundary="([^"]+)"/)?.[1];
    expect(boundary).toBeTruthy();

    // Header, body part, file part, closing delimiter — in that order.
    expect(decoded).toContain(`Content-Type: multipart/mixed; boundary="${boundary}"`);
    expect(decoded).toContain('Content-Type: text/plain; charset="UTF-8"');
    expect(decoded).toContain('Attached.');
    expect(decoded).toContain('Content-Type: application/pdf');
    expect(decoded).toContain(
      'Content-Disposition: attachment; filename="contract-v3.pdf"',
    );
    expect(decoded).toContain('Content-Transfer-Encoding: base64');
    expect(decoded).toContain(btoa('some bytes'));
    expect(decoded.trimEnd().endsWith(`--${boundary}--`)).toBe(true);
  });

  it('stays a plain text/plain message when nothing is attached', () => {
    const raw = buildRawMessage({
      from: { name: '', email: 'marc@ferrum.dev' },
      to: [{ name: '', email: 'dana@lumenpartners.com' }],
      cc: [],
      bcc: [],
      subject: 'No files',
      body: 'Just words.',
      attachments: [],
    });
    expect(decodeBase64Url(raw)).not.toContain('multipart/mixed');
  });

  it('wraps long base64 payloads at 76 characters (RFC 2045)', () => {
    const raw = buildRawMessage({
      from: { name: '', email: 'marc@ferrum.dev' },
      to: [{ name: '', email: 'dana@lumenpartners.com' }],
      cc: [],
      bcc: [],
      subject: 'Big',
      body: 'See attached.',
      attachments: [
        {
          id: 'a1',
          filename: 'big.bin',
          size: 600,
          mimeType: 'application/octet-stream',
          data: 'A'.repeat(600),
        },
      ],
    });

    const payloadLines = decodeBase64Url(raw)
      .split('\r\n')
      .filter((line) => /^A+$/.test(line));
    expect(payloadLines.length).toBe(8);
    expect(payloadLines.every((line) => line.length <= 76)).toBe(true);
  });
});

/**
 * The header builder's two RFC failures. Both were reachable by anyone with a
 * "Last, First" contact or a filename outside ASCII — which is to say, most
 * people outside an English-only address book.
 */
describe('buildRawMessage header encoding', () => {
  const base = {
    from: { name: '', email: 'marc@ferrum.dev' },
    cc: [],
    bcc: [],
    subject: 'Redlines',
    body: 'Text.',
  };

  it('quotes a display name containing a comma (RFC 5322)', () => {
    const raw = buildRawMessage({
      ...base,
      to: [{ name: 'Whitlock, Dana', email: 'dana@lumen.com' }],
    });
    const to = decodeBase64Url(raw).split('\r\n').find((l) => l.startsWith('To: '));
    expect(to).toBe('To: "Whitlock, Dana" <dana@lumen.com>');
  });

  it('leaves an ordinary name unquoted', () => {
    const raw = buildRawMessage({
      ...base,
      to: [{ name: 'Dana Whitlock', email: 'dana@lumen.com' }],
    });
    expect(decodeBase64Url(raw)).toContain('To: Dana Whitlock <dana@lumen.com>');
  });

  it('does not quote an RFC 2047 encoded-word', () => {
    const raw = buildRawMessage({
      ...base,
      to: [{ name: 'Inês Carvalho', email: 'ines@carvalho-arq.pt' }],
    });
    const to = decodeBase64Url(raw).split('\r\n').find((l) => l.startsWith('To: '))!;
    expect(to).toContain('=?UTF-8?B?');
    expect(to).not.toContain('"=?UTF-8?B?');
  });

  it('encodes a non-ASCII attachment filename per RFC 2231', () => {
    const raw = buildRawMessage({
      ...base,
      to: [{ name: '', email: 'dana@lumen.com' }],
      attachments: [
        {
          id: 'a1',
          filename: 'Réunion.pdf',
          size: 4,
          mimeType: 'application/pdf',
          data: btoa('data'),
        },
      ],
    });

    const decoded = decodeBase64Url(raw);
    expect(decoded).toContain("filename*=UTF-8''R%C3%A9union.pdf");
    // No raw 8-bit octets in a header line.
    expect(decoded).not.toContain('Réunion.pdf');
  });

  it('encodes a filename containing a quote rather than breaking the header', () => {
    const raw = buildRawMessage({
      ...base,
      to: [{ name: '', email: 'dana@lumen.com' }],
      attachments: [
        {
          id: 'a1',
          filename: 'the "final" draft.pdf',
          size: 4,
          mimeType: 'application/pdf',
          data: btoa('data'),
        },
      ],
    });
    expect(decodeBase64Url(raw)).toContain("filename*=UTF-8''");
  });
});

/** Gmail threads on In-Reply-To and References, not on threadId alone. */
describe('threading headers', () => {
  it('carries both when replying', () => {
    const raw = buildRawMessage({
      from: { name: '', email: 'marc@ferrum.dev' },
      to: [{ name: '', email: 'dana@lumen.com' }],
      cc: [],
      bcc: [],
      subject: 'Re: Redlines',
      body: 'Agreed.',
      inReplyTo: '<b@lumen.com>',
      references: '<a@lumen.com> <b@lumen.com>',
    });

    const decoded = decodeBase64Url(raw);
    expect(decoded).toContain('In-Reply-To: <b@lumen.com>');
    expect(decoded).toContain('References: <a@lumen.com> <b@lumen.com>');
  });

  it('omits them on a new message', () => {
    const raw = buildRawMessage({
      from: { name: '', email: 'marc@ferrum.dev' },
      to: [{ name: '', email: 'dana@lumen.com' }],
      cc: [],
      bcc: [],
      subject: 'Hello',
      body: 'Hi.',
    });
    const decoded = decodeBase64Url(raw);
    expect(decoded).not.toContain('In-Reply-To:');
    expect(decoded).not.toContain('References:');
  });
});

/**
 * Real accounts send from aliases, `+` addressing and Workspace "send mail as"
 * identities, and users/me/profile only ever reports the primary. Matching on
 * the address alone read the user's own alias-sent mail as incoming — which put
 * *them* in their own Screener as an unknown sender, and hid the threads they
 * had started from their inbox.
 */

/**
 * Gmail decodes the transfer encoding and leaves the character set alone, so
 * assuming UTF-8 rendered every windows-1252 or Shift_JIS message as a field of
 * replacement characters — which is a lot of mail from mailing lists and older
 * senders.
 */

/**
 * Gmail wraps its attribution line for any reasonably long name or date, so the
 * single-line marker never matched and the fallback cut one line late — leaving
 * "On Mon, 20 Jul 2026 at 16:12 Dana Whitlock <dana@lumen.com> wrote:" in the
 * visible body of essentially every threaded reply.
 */
describe('splitting a wrapped attribution', () => {
  it('cuts above a two-line English attribution', () => {
    const { body, quoted } = splitQuoted(
      [
        'Happy with 750 as a middle.',
        '',
        'On Mon, 20 Jul 2026 at 16:12 Dana Whitlock <dana@lumen.com>',
        'wrote:',
        '> Any movement on the cap?',
      ].join('\n'),
    );

    expect(body).toBe('Happy with 750 as a middle.');
    expect(quoted).toContain('On Mon, 20 Jul 2026');
  });

  it('cuts above a non-English attribution it has no rule for', () => {
    const { body, quoted } = splitQuoted(
      [
        'Merci, c’est noté.',
        '',
        'Le 20 juillet 2026 à 16:12, Dana Whitlock <dana@lumen.com> a écrit :',
        '> Une question sur le contrat.',
      ].join('\n'),
    );

    expect(body).toBe('Merci, c’est noté.');
    expect(quoted).toContain('a écrit');
  });

  it('leaves an ordinary line above a quote alone', () => {
    const { body } = splitQuoted(['Two thoughts below.', '> the first', '> the second'].join('\n'));
    expect(body).toBe('Two thoughts below.');
  });

  it('leaves a body of only an attribution and a quote empty, as before', () => {
    // Nothing was written above the quote, so there is no body to keep.
    const { body, quoted } = splitQuoted(
      ['On 20 Jul 2026 at 16:12 Dana wrote:', '> Hello'].join('\n'),
    );
    expect(body).toBe('');
    expect(quoted).toContain('> Hello');
  });
});

/** Details that only bite on real mail. */
describe('smaller real-mail details', () => {
  it("gives the body CRLF line endings, not the browser's", () => {
    const raw = buildRawMessage({
      from: { name: '', email: 'marc@ferrum.dev' },
      to: [{ name: '', email: 'dana@lumen.com' }],
      cc: [],
      bcc: [],
      subject: 'Notes',
      body: 'First line.\nSecond line.',
    });

    const decoded = decodeBase64Url(raw);
    expect(decoded).toContain('First line.\r\nSecond line.');
    expect(decoded).not.toMatch(/[^\r]\nSecond/);
  });

});

/**
 * The flattener had no tests at all, which is how it shipped throwing away
 * every link destination in every HTML-only message.
 */
describe('htmlToText', () => {
  it('keeps a link destination the text does not already carry', () => {
    const text = htmlToText(
      '<p><a href="https://accounts.example.com/reset?token=abc">Reset your password</a></p>',
    );
    expect(text).toBe('Reset your password (https://accounts.example.com/reset?token=abc)');
  });

  it('does not repeat a URL that is its own link text', () => {
    const text = htmlToText('<a href="https://example.com/x">https://example.com/x</a>');
    expect(text).toBe('https://example.com/x');
  });

  it('drops destinations that go nowhere useful', () => {
    expect(htmlToText('<a href="#top">Back to top</a>')).toBe('Back to top');
    expect(htmlToText('<a href="javascript:void(0)">Menu</a>')).toBe('Menu');
  });

  it('keeps a mailto so a reply address survives', () => {
    expect(htmlToText('<a href="mailto:dana@example.com">Dana</a>')).toBe(
      'Dana (mailto:dana@example.com)',
    );
  });

  it('separates block elements instead of welding them together', () => {
    expect(htmlToText('<p>Hi Ibrahim,</p><p>Someone reset your password.</p>')).toBe(
      'Hi Ibrahim,\nSomeone reset your password.',
    );
  });

  it('gives list items a line and a marker each', () => {
    expect(htmlToText('<ul><li>Item one</li><li>Item two</li></ul>')).toBe(
      '- Item one\n- Item two',
    );
  });

  it('honours a line break', () => {
    expect(htmlToText('<p>Thanks,<br>The team</p>')).toBe('Thanks,\nThe team');
  });

  it('keeps table cells on one line, since mail uses tables to lay out', () => {
    expect(htmlToText('<table><tr><td>Total</td><td>$42.00</td></tr></table>')).toBe(
      'Total $42.00',
    );
  });

  it('collapses the source formatting a browser would collapse', () => {
    expect(htmlToText('<p>one\n   two\t\tthree</p>')).toBe('one two three');
  });

  it('preserves whitespace inside a pre', () => {
    expect(htmlToText('<pre>line one\n  indented</pre>')).toBe('line one\n  indented');
  });

  it('strips script and style content rather than reading it aloud', () => {
    expect(htmlToText('<style>p{color:red}</style><p>Body</p><script>x()</script>')).toBe('Body');
  });
});

/**
 * Outgoing mail carried a `text/plain` part and nothing else, so a message
 * arrived in the recipient's client as one undifferentiated block. The text
 * half still goes out unchanged beside the HTML — it is what a screen reader,
 * a terminal client and every search index read.
 */
describe('sending an HTML half', () => {
  const base = {
    from: { name: 'Marc', email: 'marc@ferrum.dev' },
    to: [{ name: 'Dana', email: 'dana@lumen.com' }],
    cc: [],
    bcc: [],
    subject: 'Contract redlines',
  };

  it('sends text alone when there is no HTML', () => {
    const raw = decodeBase64Url(buildRawMessage({ ...base, body: 'Sending Friday.' }));
    expect(raw).toContain('Content-Type: text/plain; charset="UTF-8"');
    expect(raw).not.toContain('multipart/alternative');
  });

  it('sends both halves, plainest first, when there is', () => {
    const raw = decodeBase64Url(
      buildRawMessage({ ...base, body: 'Sending Friday.', bodyHtml: '<p>Sending Friday.</p>' }),
    );
    expect(raw).toContain('multipart/alternative');
    // RFC 2046: clients render the last alternative they understand.
    expect(raw.indexOf('text/plain')).toBeLessThan(raw.indexOf('text/html'));
    expect(raw).toContain('<p>Sending Friday.</p>');
    expect(raw).toContain('Sending Friday.');
  });

  it('nests the alternative inside the mixed part when a file rides along', () => {
    const raw = decodeBase64Url(
      buildRawMessage({
        ...base,
        body: 'Deck attached.',
        bodyHtml: '<p>Deck attached.</p>',
        attachments: [
          { id: 'a1', filename: 'deck.pdf', mimeType: 'application/pdf', size: 4, data: 'AAAA' },
        ],
      }),
    );
    expect(raw.indexOf('multipart/mixed')).toBeLessThan(raw.indexOf('multipart/alternative'));
    expect(raw).toContain('Content-Disposition: attachment');
  });
});

describe('textToHtml', () => {
  it('makes a paragraph of each block, which is the structure text/plain loses', () => {
    expect(textToHtml('One.\n\nTwo.')).toBe('<p>One.</p><p>Two.</p>');
  });

  it('keeps a single newline as a line break inside its paragraph', () => {
    expect(textToHtml('Thanks,\nMarc')).toBe('<p>Thanks,<br>Marc</p>');
  });

  it('escapes what would otherwise be read as markup', () => {
    // A quoted reply line starts with ">" and must not become a tag.
    expect(textToHtml('> earlier text & more')).toBe('<p>&gt; earlier text &amp; more</p>');
  });

  it('produces nothing at all for an empty body', () => {
    expect(textToHtml('   ')).toBe('');
  });
});
