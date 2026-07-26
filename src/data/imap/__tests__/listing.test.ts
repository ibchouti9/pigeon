import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ImapMailProvider } from '../imapProvider';
import type { BridgeStub } from '../bridge';

/**
 * What a listing costs, and what the screening cutoff holds back.
 *
 * These two are one story. A 40,000-thread account was unusable because listing
 * the inbox meant fetching every conversation in it — five round trips and every
 * byte of every message, per row, to render a name and a subject — and because
 * §2.3 would then have offered the user several hundred strangers to judge
 * before they reached any mail. The engine answers rows in bulk now, and
 * screening starts the day Pigeon is set up.
 *
 * The bridge here counts commands, because the cost *is* the behaviour: a
 * listing that quietly went back to one `mail_get_thread` per row would pass
 * every other test in the suite.
 */

const bridge = vi.hoisted(() => ({
  handler: null as ((command: string, args?: Record<string, unknown>) => unknown) | null,
}));

vi.mock('../../../lib/desktop', () => ({
  isDesktop: () => false,
  invoke: async (command: string, args?: Record<string, unknown>) => {
    if (!bridge.handler) throw new Error(`no bridge handler for ${command}`);
    return bridge.handler(command, args);
  },
  openExternal: async () => undefined,
}));

const SETUP_AT = '2026-07-26T12:00:00.000Z';
const BEFORE_SETUP = '2026-05-01T09:00:00.000Z';
const AFTER_SETUP = '2026-07-26T15:00:00.000Z';

interface FakeThread {
  id: string;
  from: string;
  /** When the conversation started, which is what the cutoff judges. */
  startedAt: string;
  lastMessageAt?: string;
}

function stub(t: FakeThread, index: number): BridgeStub {
  return {
    id: t.id,
    lastMessageAt: t.lastMessageAt ?? t.startedAt,
    firstMessageAt: t.startedAt,
    unread: false,
    messageCount: 2,
    inInbox: true,
    lastUid: index + 100,
    previewUid: index + 100,
    fromUser: false,
    from: { name: '', email: t.from },
    subject: `Subject ${t.id}`,
    snippetText: `Preview line for ${t.id}`,
    snippetHtml: null,
  };
}

/** An in-memory Gmail that records every command it is asked for. */
function fakeGmail(threads: FakeThread[], { pageSize = 200 } = {}) {
  const calls: string[] = [];

  bridge.handler = (command, args) => {
    calls.push(command);
    switch (command) {
      case 'mail_status':
        return { connected: true, email: 'marc@ferrum.dev' };
      case 'mail_sent_recipients':
        return [];
      case 'mail_list_threads': {
        const offset = Number(args?.offset ?? 0);
        const limit = Number(args?.limit ?? pageSize);
        return {
          total: threads.length,
          threads: threads.slice(offset, offset + limit).map(stub),
        };
      }
      case 'mail_get_thread': {
        const found = threads.find((t) => t.id === args?.threadId);
        if (!found) throw "This thread didn't load. It's still in Gmail.";
        return {
          id: found.id,
          subject: `Subject ${found.id}`,
          inInbox: true,
          unread: false,
          lastMessageAt: found.lastMessageAt ?? found.startedAt,
          messages: [
            {
              id: `m-${found.id}`,
              uid: 100,
              subject: `Subject ${found.id}`,
              from: { name: '', email: found.from },
              to: [{ name: '', email: 'marc@ferrum.dev' }],
              cc: [],
              date: found.startedAt,
              text: `The whole of what ${found.from} wrote.`,
              html: null,
              attachments: [],
              messageId: null,
              unread: false,
              fromUser: false,
            },
          ],
        };
      }
      case 'mail_silence':
      case 'mail_mark_read':
      case 'mail_set_place':
        return undefined;
      default:
        throw new Error(`unexpected bridge command ${command}`);
    }
  };

  return {
    calls,
    countOf: (command: string) => calls.filter((c) => c === command).length,
  };
}

/** Pigeon was set up at `SETUP_AT`, whatever the wall clock says. */
function setUpAt(at: string) {
  localStorage.setItem('pigeon.screenFrom.marc@ferrum.dev', at);
}

beforeEach(() => {
  localStorage.clear();
});

describe('listing a place', () => {
  it('renders rows without fetching a single conversation', async () => {
    const gmail = fakeGmail(
      Array.from({ length: 50 }, (_, i) => ({
        id: `t${i}`,
        from: `sender${i}@example.com`,
        startedAt: BEFORE_SETUP,
      })),
    );
    setUpAt(SETUP_AT);

    const threads = await new ImapMailProvider().listThreads('inbox');

    expect(threads).toHaveLength(50);
    // The whole point. One listing, no per-thread fetches.
    expect(gmail.countOf('mail_list_threads')).toBe(1);
    expect(gmail.countOf('mail_get_thread')).toBe(0);
  });

  it('gives each row the sender, subject and preview line a list shows', async () => {
    fakeGmail([{ id: 't1', from: 'dana@lumen.com', startedAt: BEFORE_SETUP }]);
    setUpAt(SETUP_AT);

    const [row] = await new ImapMailProvider().listThreads('inbox');

    expect(row.preview).toBe(true);
    expect(row.subject).toBe('Subject t1');
    expect(row.messages[0].from.email).toBe('dana@lumen.com');
    expect(row.messages[0].body).toBe('Preview line for t1');
    // The row reports the conversation's real length, not its one synthetic
    // message — otherwise every thread in the list reads as a single message.
    expect(row.messageCount).toBe(2);
  });

  it('fetches the conversation when it is opened, and only then', async () => {
    const gmail = fakeGmail([{ id: 't1', from: 'dana@lumen.com', startedAt: BEFORE_SETUP }]);
    setUpAt(SETUP_AT);
    const provider = new ImapMailProvider();

    await provider.listThreads('inbox');
    expect(gmail.countOf('mail_get_thread')).toBe(0);

    const opened = await provider.getThread('t1');
    expect(gmail.countOf('mail_get_thread')).toBe(1);
    expect(opened.preview).toBeUndefined();
    expect(opened.messages[0].body).toContain('The whole of what');

    // Opened once, cached: reopening is free, and the *row* is now the real
    // conversation rather than the preview it was listed as.
    await provider.getThread('t1');
    expect(gmail.countOf('mail_get_thread')).toBe(1);
    const [row] = await provider.listThreads('inbox');
    expect(row.preview).toBeUndefined();
  });

  it('windows the list and reports what is older', async () => {
    const many = Array.from({ length: 500 }, (_, i) => ({
      id: `t${i}`,
      from: `sender${i}@example.com`,
      startedAt: BEFORE_SETUP,
    }));
    fakeGmail(many, { pageSize: 200 });
    setUpAt(SETUP_AT);
    const provider = new ImapMailProvider();

    const first = await provider.listThreads('inbox');
    expect(first).toHaveLength(200);
    expect(provider.hasOlder('inbox')).toBe(true);

    expect(await provider.listOlder('inbox')).toHaveLength(400);
    expect(provider.hasOlder('inbox')).toBe(true);

    expect(await provider.listOlder('inbox')).toHaveLength(500);
    // Every conversation is listed; there is nothing older to ask for, and
    // asking anyway is not an error.
    expect(provider.hasOlder('inbox')).toBe(false);
    expect(await provider.listOlder('inbox')).toHaveLength(500);
  });
});

describe('the screening cutoff', () => {
  it('leaves mail that was already there where Gmail put it', async () => {
    fakeGmail([{ id: 'old', from: 'stranger@example.com', startedAt: BEFORE_SETUP }]);
    setUpAt(SETUP_AT);
    const provider = new ImapMailProvider();

    // Nothing to judge, and nothing hidden: the conversation is in the inbox,
    // which is where it was before Pigeon existed.
    expect(await provider.listHeld()).toHaveLength(0);
    expect(await provider.listThreads('inbox')).toHaveLength(1);
  });

  it('screens a conversation that starts after setup', async () => {
    fakeGmail([{ id: 'new', from: 'stranger@example.com', startedAt: AFTER_SETUP }]);
    setUpAt(SETUP_AT);
    const provider = new ImapMailProvider();

    const held = await provider.listHeld();
    expect(held).toHaveLength(1);
    expect(held[0].sender.email).toBe('stranger@example.com');
    // §2.3 — a held sender is in the Screener and nowhere else.
    expect(await provider.listThreads('inbox')).toHaveLength(0);
  });

  /**
   * The reason the cutoff is a date on the conversation's *start* rather than on
   * its latest message: a mailing list that has run for years would otherwise
   * arrive in the Screener on its next reply, as if it were a stranger.
   */
  it('does not screen an old conversation because of a new reply', async () => {
    fakeGmail([
      {
        id: 'long-running',
        from: 'list@example.com',
        startedAt: BEFORE_SETUP,
        lastMessageAt: AFTER_SETUP,
      },
    ]);
    setUpAt(SETUP_AT);

    expect(await new ImapMailProvider().listHeld()).toHaveLength(0);
  });

  /**
   * A Screener card shows a preview and §7.9's AI read summarises it, so held
   * conversations are the one thing a listing hydrates — bounded by the cutoff,
   * which is what makes it a handful rather than a mailbox.
   */
  it('reads the bodies of what it holds, and nothing else', async () => {
    const gmail = fakeGmail([
      { id: 'held', from: 'stranger@example.com', startedAt: AFTER_SETUP },
      { id: 'old-1', from: 'someone@example.com', startedAt: BEFORE_SETUP },
      { id: 'old-2', from: 'another@example.com', startedAt: BEFORE_SETUP },
    ]);
    setUpAt(SETUP_AT);

    const held = await new ImapMailProvider().listHeld();

    expect(held).toHaveLength(1);
    expect(held[0].messages[0].body).toContain('The whole of what');
    expect(gmail.countOf('mail_get_thread')).toBe(1);
  });

  it('starts screening at first connect and never moves the line', async () => {
    fakeGmail([{ id: 't1', from: 'stranger@example.com', startedAt: BEFORE_SETUP }]);

    // No stored cutoff: connecting sets it, and that first run's mail is history.
    await new ImapMailProvider().getAccount();
    const first = localStorage.getItem('pigeon.screenFrom.marc@ferrum.dev');
    expect(first).toBeTruthy();

    // A later session must not move it forward — mail that arrived in between
    // would slip past the Screener without anyone deciding anything.
    await new ImapMailProvider().getAccount();
    expect(localStorage.getItem('pigeon.screenFrom.marc@ferrum.dev')).toBe(first);
  });
});
