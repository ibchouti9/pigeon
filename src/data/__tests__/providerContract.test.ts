import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MockMailProvider } from '../mock/mockProvider';
import { ImapMailProvider } from '../imap/imapProvider';
import type { MailProvider } from '../provider';

/**
 * The IMAP provider reaches Rust through this seam; here, "Rust" is an
 * in-memory Gmail.
 */
const bridge = vi.hoisted(() => {
  const state = {
    handler: null as ((command: string, args?: Record<string, unknown>) => unknown) | null,
  };
  return state;
});

vi.mock('../../lib/desktop', () => ({
  isDesktop: () => false,
  invoke: async (command: string, args?: Record<string, unknown>) => {
    if (!bridge.handler) throw new Error(`no bridge handler for ${command}`);
    return bridge.handler(command, args);
  },
  openExternal: async () => undefined,
}));

/** An in-memory Gmail holding the two piles below, spoken in bridge JSON. */
function stubImapBridge() {
  const archived = new Set<string>();
  const threads = HELD.flatMap((h) => [
    { id: `${h.id}-a`, from: `${h.id}@example.com`, date: h.oldest },
    { id: `${h.id}-b`, from: `${h.id}@example.com`, date: h.newest },
  ]);

  bridge.handler = (command, args) => {
    const visible = threads.filter((t) => !archived.has(t.id));
    switch (command) {
      case 'mail_status':
        return { connected: true, email: 'marc@ferrum.dev' };
      case 'mail_sent_recipients':
        return [];
      case 'mail_list_threads': {
        const inInbox = args?.place === 'inbox';
        const listed = inInbox ? visible : [];
        return {
          total: listed.length,
          threads: listed.map((t, i) => ({
            id: t.id,
            lastMessageAt: t.date,
            unread: false,
            messageCount: 1,
            lastUid: i + 1,
          })),
        };
      }
      case 'mail_get_thread': {
        const thread = threads.find((t) => t.id === args?.threadId);
        if (!thread) throw "This thread didn't load. It's still in Gmail.";
        return {
          id: thread.id,
          subject: 'Hello',
          inInbox: !archived.has(thread.id),
          unread: false,
          lastMessageAt: thread.date,
          messages: [
            {
              id: `m-${thread.id}`,
              uid: 1,
              subject: 'Hello',
              from: { name: '', email: thread.from },
              to: [{ name: '', email: 'marc@ferrum.dev' }],
              cc: [],
              date: thread.date,
              text: 'Body text.',
              html: null,
              attachments: [],
              messageId: null,
              unread: false,
              fromUser: false,
            },
          ],
        };
      }
      case 'mail_silence': {
        const id = String(args?.threadId);
        if (args?.silence) archived.add(id);
        else archived.delete(id);
        return undefined;
      }
      case 'mail_mark_read':
      case 'mail_set_place':
        return undefined;
      case 'mail_attachment':
        throw "This attachment didn't load.";
      default:
        throw new Error(`unexpected bridge command ${command}`);
    }
  };
}

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
    name: 'ImapMailProvider',
    make: () => {
      stubImapBridge();
      return new ImapMailProvider();
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

    /**
     * Approving is the one action that must never take mail away. A Gmail-side
     * flag marking "this approval reversed a decline" was set for any previous
     * decline, including one that had kept the sender's conversations on
     * screen — so this exact cycle made all of them vanish. The mock cannot
     * express that bug, which is why it needs pinning on both.
     */
    it('never hides mail by approving', async () => {
      const held = await provider.listHeld();
      const target = held[0];
      expect(target).toBeTruthy();

      await provider.decideSender(target.sender.id, 'approved');
      const approved = (await provider.listThreads('inbox')).length;

      await provider.decideSender(target.sender.id, 'declined');
      expect((await provider.listThreads('inbox')).length).toBe(approved);

      await provider.decideSender(target.sender.id, 'approved');
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
