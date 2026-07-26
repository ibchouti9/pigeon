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
  /** Threads Gmail has archived out of the inbox, as `silence` asks it to. */
  const archived = new Set<string>();
  const threads = HELD.flatMap((h) => [
    { id: `${h.id}-a`, from: `${h.id}@example.com`, date: h.oldest },
    { id: `${h.id}-b`, from: `${h.id}@example.com`, date: h.newest },
  ]);

  vi.stubGlobal('fetch', async (url: string) => {
    const href = String(url);
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
    const visible = threads.filter((t) => !archived.has(t.id));

    if (/users\/me\/profile/.test(href)) {
      return json({ emailAddress: 'marc@ferrum.dev', threadsTotal: threads.length });
    }
    if (/people\/me\/connections/.test(href)) return json({ connections: [] });
    if (/people\/me\?/.test(href)) return json({ names: [{ displayName: 'Marc Ferrum' }] });
    if (/messages\?/.test(href)) return json({ messages: [] });

    if (/threads\?/.test(href)) {
      return json({ threads: visible.map((t) => ({ id: t.id, historyId: '1' })) });
    }

    /*
     * Enough of the label API for `silence` to actually do something. Without
     * it, declining is a no-op here and the two §2.3 reversal rules below
     * cannot tell a provider that honours them from one that doesn't — the
     * fixture would pass either way.
     */
    if (/\/labels$/.test(href)) return json({ labels: [{ id: 'lbl-1', name: 'Pigeon/Declined' }] });
    if (/\/modify$/.test(href)) {
      const id = href.match(/threads\/([^/]+)\/modify/)?.[1];
      if (id) archived.add(id);
      return json({ id });
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

  it('reports each page as it lands, not only the finished walk', async () => {
    const pages: number[] = [];
    const all = await provider.listThreads('inbox', (threads) => pages.push(threads.length));

    // A caller that passes onPage hears from it. Otherwise a consumer comes to
    // depend on the final resolution alone, and the screen that has no progress
    // bar behind it sits on a skeleton for the length of the whole walk.
    expect(pages.length).toBeGreaterThan(0);
    expect(pages[pages.length - 1]).toBe(all.length);
  });

  it('resolves with the same list it last published', async () => {
    let last: number | null = null;
    const all = await provider.listThreads('archive', (threads) => {
      last = threads.length;
    });
    expect(last).toBe(all.length);
  });

  /**
   * §2.3 states these two "explicitly for the coding agent", and both turn on
   * what the sender was *before* the decision — which neither provider looked
   * at. A reversed decline pushed the old held mail into the inbox as if it had
   * just arrived, and declining an already-approved sender took away the mail
   * the user had been reading.
   */
  describe('§2.3 reversals', () => {
    it('does not surface old mail when a decline is reversed', async () => {
      const held = await provider.listHeld();
      const target = held[0];
      expect(target, 'the fixture needs a held sender').toBeTruthy();

      const before = (await provider.listThreads('inbox')).length;
      await provider.decideSender(target.sender.id, 'declined');
      await provider.decideSender(target.sender.id, 'approved');

      // "Reversing a decline in Settings only affects mail received after the
      // reversal."
      expect((await provider.listThreads('inbox')).length).toBe(before);
    });

    it('leaves an approved sender’s threads alone when they are later declined', async () => {
      const held = await provider.listHeld();
      const target = held[0];
      expect(target).toBeTruthy();

      await provider.decideSender(target.sender.id, 'approved');
      const approved = (await provider.listThreads('inbox')).length;

      await provider.decideSender(target.sender.id, 'declined');

      // "Declining a previously approved sender leaves their existing inbox
      // threads in place and silences future mail."
      expect((await provider.listThreads('inbox')).length).toBe(approved);
    });

    it('still silences mail that was only ever waiting in the Screener', async () => {
      const held = await provider.listHeld();
      const target = held[0];
      const before = (await provider.listThreads('inbox')).length;

      await provider.decideSender(target.sender.id, 'declined');

      // D7 — declining from the Screener silences what was waiting; it must not
      // quietly add anything either.
      expect((await provider.listThreads('inbox')).length).toBeLessThanOrEqual(before);
    });
  });

  it('refuses to download an attachment that does not exist', async () => {
    await expect(provider.downloadAttachment('no-such-message', 'no-such-file')).rejects.toThrow();
  });
});
