import { describe, expect, it } from 'vitest';
import {
  buildRawMessage,
  decodeBase64Url,
  encodeBase64Url,
  parseAddressList,
  splitQuoted,
  toMessage,
  type GmailMessage,
} from '../mime';

describe('base64url', () => {
  it('round-trips UTF-8', () => {
    const text = 'Résumé — naïve café 😀';
    expect(decodeBase64Url(encodeBase64Url(text))).toBe(text);
  });

  it('tolerates missing padding, as Gmail sends it', () => {
    expect(decodeBase64Url('SGVsbG8')).toBe('Hello');
  });

  it('returns an empty string rather than throwing on junk', () => {
    expect(decodeBase64Url('!!!not base64!!!')).toBe('');
  });
});

describe('parseAddressList', () => {
  it('parses a display name and address', () => {
    expect(parseAddressList('Dana Whitlock <dana@lumenpartners.com>')).toEqual([
      { name: 'Dana Whitlock', email: 'dana@lumenpartners.com' },
    ]);
  });

  it('parses a bare address', () => {
    expect(parseAddressList('sana@northbound.io')).toEqual([
      { name: '', email: 'sana@northbound.io' },
    ]);
  });

  it('does not split on a comma inside a quoted display name', () => {
    const parsed = parseAddressList('"Whitlock, Dana" <dana@lumen.com>, sana@north.io');
    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toEqual({ name: 'Whitlock, Dana', email: 'dana@lumen.com' });
  });

  it('returns nothing for an empty header', () => {
    expect(parseAddressList('')).toEqual([]);
  });
});

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

describe('toMessage', () => {
  const raw: GmailMessage = {
    id: 'm1',
    threadId: 't1',
    internalDate: '1750000000000',
    labelIds: ['INBOX', 'UNREAD'],
    payload: {
      mimeType: 'multipart/alternative',
      headers: [
        { name: 'From', value: 'Dana Whitlock <dana@lumenpartners.com>' },
        { name: 'To', value: 'marc@ferrum.dev' },
        { name: 'Subject', value: 'Contract redlines' },
      ],
      parts: [
        { mimeType: 'text/plain', body: { data: encodeBase64Url('Legal came back.') } },
        { mimeType: 'text/html', body: { data: encodeBase64Url('<p>Legal came back.</p>') } },
      ],
    },
  };

  it('prefers the plain-text part', () => {
    expect(toMessage(raw, 'marc@ferrum.dev').body).toBe('Legal came back.');
  });

  it('marks the user\'s own mail', () => {
    expect(toMessage(raw, 'marc@ferrum.dev').isFromUser).toBe(false);
    expect(toMessage(raw, 'dana@lumenpartners.com').isFromUser).toBe(true);
  });

  it('collects attachments from nested parts', () => {
    const withAttachment: GmailMessage = {
      ...raw,
      payload: {
        ...raw.payload,
        parts: [
          ...(raw.payload?.parts ?? []),
          {
            mimeType: 'application/pdf',
            filename: 'MSA-v4-redline.pdf',
            body: { attachmentId: 'a1', size: 245760 },
          },
        ],
      },
    };
    const message = toMessage(withAttachment, 'marc@ferrum.dev');
    expect(message.attachments).toHaveLength(1);
    expect(message.attachments[0].filename).toBe('MSA-v4-redline.pdf');
  });

  it('falls back to HTML when there is no plain-text alternative', () => {
    const htmlOnly: GmailMessage = {
      ...raw,
      payload: {
        mimeType: 'text/html',
        headers: raw.payload?.headers,
        body: { data: encodeBase64Url('<p>Hello <b>there</b></p>') },
      },
    };
    expect(toMessage(htmlOnly, 'marc@ferrum.dev').body).toBe('Hello there');
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
    // And it reads back as one address, not two.
    expect(parseAddressList(to!.slice(4))).toHaveLength(1);
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
describe('recognising the user\'s own messages', () => {
  function raw(from: string, labelIds?: string[]) {
    return {
      id: 'm1',
      threadId: 't1',
      labelIds,
      internalDate: '1750000000000',
      payload: {
        headers: [
          { name: 'From', value: from },
          { name: 'To', value: 'dana@lumen.com' },
          { name: 'Subject', value: 'Hello' },
        ],
        mimeType: 'text/plain',
        body: { data: encodeBase64Url('Body.') },
      },
    };
  }

  it('trusts Gmail\'s SENT label over the address', () => {
    const message = toMessage(raw('marc+work@ferrum.dev', ['SENT']), 'marc@ferrum.dev');
    expect(message.isFromUser).toBe(true);
  });

  it('still matches on the primary address when there is no label', () => {
    expect(toMessage(raw('marc@ferrum.dev'), 'marc@ferrum.dev').isFromUser).toBe(true);
  });

  it('does not claim someone else\'s mail', () => {
    const message = toMessage(raw('dana@lumen.com', ['INBOX']), 'marc@ferrum.dev');
    expect(message.isFromUser).toBe(false);
  });
});

/**
 * Gmail decodes the transfer encoding and leaves the character set alone, so
 * assuming UTF-8 rendered every windows-1252 or Shift_JIS message as a field of
 * replacement characters — which is a lot of mail from mailing lists and older
 * senders.
 */
describe('character sets', () => {
  /** base64 of the given bytes, the way Gmail hands a body back. */
  function b64(bytes: number[]) {
    return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_');
  }

  function message(charset: string, bytes: number[]) {
    return {
      id: 'm1',
      threadId: 't1',
      internalDate: '1750000000000',
      payload: {
        headers: [
          { name: 'From', value: 'Dana <dana@lumen.com>' },
          { name: 'Subject', value: 'Hello' },
        ],
        mimeType: 'multipart/alternative',
        parts: [
          {
            mimeType: 'text/plain',
            headers: [{ name: 'Content-Type', value: `text/plain; charset="${charset}"` }],
            body: { data: b64(bytes) },
          },
        ],
      },
    };
  }

  it('decodes a windows-1252 body in its own charset', () => {
    // 0xE9 is é in windows-1252 and invalid on its own in UTF-8.
    const parsed = toMessage(message('windows-1252', [0x52, 0xe9, 0x75, 0x6e, 0x69, 0x6f, 0x6e]), 'marc@ferrum.dev');
    expect(parsed.body).toBe('Réunion');
    expect(parsed.body).not.toContain('\uFFFD');
  });

  it('still decodes UTF-8 when that is what the part declares', () => {
    const parsed = toMessage(message('utf-8', [0x52, 0xc3, 0xa9, 0x75, 0x6e, 0x69, 0x6f, 0x6e]), 'marc@ferrum.dev');
    expect(parsed.body).toBe('Réunion');
  });

  it('falls back to UTF-8 rather than losing a body to an unknown label', () => {
    const parsed = toMessage(message('x-nonsense', [0x48, 0x69]), 'marc@ferrum.dev');
    expect(parsed.body).toBe('Hi');
  });
});

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

  it('unescapes the snippet it falls back to', () => {
    const parsed = toMessage(
      {
        id: 'm1',
        threadId: 't1',
        internalDate: '1750000000000',
        snippet: 'Don&#39;t forget the &amp; sign',
        payload: {
          headers: [
            { name: 'From', value: 'Dana <dana@lumen.com>' },
            { name: 'Subject', value: 'Reminder' },
          ],
        },
      },
      'marc@ferrum.dev',
    );

    expect(parsed.body).toBe("Don't forget the & sign");
  });
});
