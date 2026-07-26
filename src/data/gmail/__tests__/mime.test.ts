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
});
