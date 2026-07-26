import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MockMailProvider } from '../mock/mockProvider';
import { GmailMailProvider } from '../gmail/gmailProvider';
import { encodeBase64Url } from '../gmail/mime';
import type { MailProvider } from '../provider';

vi.mock('../gmail/auth', () => ({
  accessToken: vi.fn(async () => 'test-token'),
  AuthError: class AuthError extends Error {},
}));

/**
 * Two providers implement one interface, and the UI is written against the
 * interface — so where they disagree, testing on the demo account stops
 * predicting what the product does. They had drifted: both sorted the Screener
 * by each sender's *oldest* held message, the Gmail side was fixed, and nothing
 * noticed the demo still behaved the other way.
 *
 * These are the behaviours the spec names and the screens depend on. Anything
 * one provider does that the other doesn't belongs here or in neither.
 */

/** Two held senders whose piles interleave, so an oldest-first sort is visible. */
const HELD = [
  { id: 'old-pile', newest: '2026-07-20T09:00:00.000Z', oldest: '2026-07-01T09:00:00.000Z' },
  { id: 'new-pile', newest: '2026-07-25T09:00:00.000Z', oldest: '2026-07-10T09:00:00.000Z' },
];

function gmailMessage(id: string, from: string, date: string, subject = 'Hello') {
  return {
    id: `m-${id}-${date}`,
    threadId: id,
    labelIds: ['INBOX'],
    internalDate: String(Date.parse(date)),
    payload: {
      headers: [
        { name: 'From', value: from },
        { name: 'To', value: 'marc@ferrum.dev' },
        { name: 'Subject', value: subject },
      ],
      mimeType: 'text/plain',
      body: { data: encodeBase64Url('Body text.') },
    },
  };
}

/** A Gmail backend holding the two piles above, and nothing else. */
function stubGmail() {
  const threads = HELD.flatMap((h) => [
    { id: `${h.id}-a`, from: `${h.id}@example.com`, date: h.oldest },
    { id: `${h.id}-b`, from: `${h.id}@example.com`, date: h.newest },
  ]);

  vi.stubGlobal('fetch', async (url: string) => {
    const href = String(url);
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

    if (/users\/me\/profile/.test(href)) {
      return json({ emailAddress: 'marc@ferrum.dev', threadsTotal: threads.length });
    }
    if (/people\/me\/connections/.test(href)) return json({ connections: [] });
    if (/people\/me\?/.test(href)) return json({ names: [{ displayName: 'Marc Ferrum' }] });
    if (/messages\?/.test(href)) return json({ messages: [] });

    if (/threads\?/.test(href)) {
      return json({ threads: threads.map((t) => ({ id: t.id, historyId: '1' })) });
    }

    const id = href.match(/threads\/([^?/]+)/)?.[1];
    const thread = threads.find((t) => t.id === id);
    if (thread) {
      return json({ id: thread.id, messages: [gmailMessage(thread.id, thread.from, thread.date)] });
    }
    return json({});
  });
}

/**
 * The demo's own seed is fixed, so its held senders are asserted on relatively:
 * whatever they are, the newest pile leads.
 */
const IMPLEMENTATIONS: { name: string; make: () => MailProvider }[] = [
  {
    name: 'MockMailProvider',
    make: () => {
      localStorage.clear();
      MockMailProvider.reset();
      return new MockMailProvider();
    },
  },
  {
    name: 'GmailMailProvider',
    make: () => {
      stubGmail();
      return new GmailMailProvider();
    },
  },
];

describe.each(IMPLEMENTATIONS)('$name honours the provider contract', ({ make }) => {
  let provider: MailProvider;

  beforeEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
    provider = make();
  });

  it('orders held senders by their newest waiting message, not their oldest', async () => {
    const held = await provider.listHeld();
    expect(held.length).toBeGreaterThan(1);

    const newestOf = (h: (typeof held)[number]) =>
      h.messages.reduce((latest, m) => (m.date > latest ? m.date : latest), '');

    const order = held.map(newestOf);
    const sorted = [...order].sort().reverse();
    expect(order).toEqual(sorted);
  });

  it('never puts a sender in both the Screener and the inbox (§2.3)', async () => {
    const [held, inbox] = await Promise.all([provider.listHeld(), provider.listThreads('inbox')]);
    const heldAddresses = new Set(held.map((h) => h.sender.email.toLowerCase()));

    for (const thread of inbox) {
      const sender = thread.messages.find((m) => !m.isFromUser)?.from;
      if (!sender) continue;
      expect(heldAddresses.has(sender.email.toLowerCase())).toBe(false);
    }
  });

  it('reports an account with an address', async () => {
    const account = await provider.getAccount();
    expect(account.email).toMatch(/@/);
  });

  it('refuses to download an attachment that does not exist', async () => {
    await expect(provider.downloadAttachment('no-such-message', 'no-such-file')).rejects.toThrow();
  });
});
