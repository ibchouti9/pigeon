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
