import { beforeEach, describe, expect, it } from 'vitest';
import { MockMailProvider } from '../mockProvider';

function fresh(): MockMailProvider {
  MockMailProvider.reset();
  return new MockMailProvider();
}

describe('MockMailProvider', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('seeds an inbox, an archive and a Screener', async () => {
    const provider = fresh();
    const [inbox, archive, held] = await Promise.all([
      provider.listThreads('inbox'),
      provider.listThreads('archive'),
      provider.listHeld(),
    ]);

    expect(inbox.length).toBeGreaterThan(5);
    expect(archive.length).toBeGreaterThan(3);
    expect(held).toHaveLength(12);
  });

  it('sorts threads newest first', async () => {
    const inbox = await fresh().listThreads('inbox');
    const dates = inbox.map((t) => t.lastMessageAt);
    expect([...dates].sort().reverse()).toEqual(dates);
  });

  it('proposes 342 known senders for O4 (§5.3)', async () => {
    const known = await fresh().getKnownSenders();
    expect(known).toHaveLength(342);
    expect(new Set(known.map((s) => s.email)).size).toBe(342);
  });

  describe('approving a sender', () => {
    it('moves every held message into the inbox, unread and dated today', async () => {
      const provider = fresh();
      const held = await provider.listHeld();
      const target = held.find((h) => h.messages.length > 1)!;
      const before = await provider.listThreads('inbox');

      await provider.decideSender(target.sender.id, 'approved');

      const after = await provider.listThreads('inbox');
      expect(after.length).toBe(before.length + target.messages.length);

      const arrived = after.filter((t) => !before.some((b) => b.id === t.id));
      expect(arrived.every((t) => t.unread)).toBe(true);
      expect(arrived.every((t) => Boolean(t.approvedAt))).toBe(true);
    });

    it('removes the sender from the Screener', async () => {
      const provider = fresh();
      const [first] = await provider.listHeld();
      await provider.decideSender(first.sender.id, 'approved');
      const held = await provider.listHeld();
      expect(held.some((h) => h.sender.id === first.sender.id)).toBe(false);
    });

    it('lists the sender under approved with a decision date', async () => {
      const provider = fresh();
      const [first] = await provider.listHeld();
      await provider.decideSender(first.sender.id, 'approved');
      const approved = await provider.listSenders('approved');
      const match = approved.find((s) => s.id === first.sender.id);
      expect(match?.decidedAt).toBeTruthy();
    });
  });

  describe('declining a sender', () => {
    it('silences without adding anything to the inbox (D7)', async () => {
      const provider = fresh();
      const [first] = await provider.listHeld();
      const before = await provider.listThreads('inbox');

      await provider.decideSender(first.sender.id, 'declined');

      expect(await provider.listThreads('inbox')).toHaveLength(before.length);
      expect((await provider.listSenders('declined')).some((s) => s.id === first.sender.id)).toBe(
        true,
      );
    });
  });

  describe('undo', () => {
    it('returns an approved sender to the Screener and takes the mail back out', async () => {
      const provider = fresh();
      const [first] = await provider.listHeld();
      const before = await provider.listThreads('inbox');

      await provider.decideSender(first.sender.id, 'approved');
      await provider.undecideSender(first.sender.id);

      expect(await provider.listThreads('inbox')).toHaveLength(before.length);
      expect((await provider.listHeld()).some((h) => h.sender.id === first.sender.id)).toBe(true);
    });

    it('returns a declined sender to the Screener', async () => {
      const provider = fresh();
      const [first] = await provider.listHeld();
      await provider.decideSender(first.sender.id, 'declined');
      await provider.undecideSender(first.sender.id);
      expect((await provider.listHeld()).some((h) => h.sender.id === first.sender.id)).toBe(true);
    });
  });

  describe('archiving', () => {
    it('moves a thread between places without deleting it (D8)', async () => {
      const provider = fresh();
      const [thread] = await provider.listThreads('inbox');

      await provider.setPlace(thread.id, 'archive');
      expect((await provider.listThreads('inbox')).some((t) => t.id === thread.id)).toBe(false);
      expect((await provider.listThreads('archive')).some((t) => t.id === thread.id)).toBe(true);

      await provider.setPlace(thread.id, 'inbox');
      expect((await provider.listThreads('inbox')).some((t) => t.id === thread.id)).toBe(true);
    });
  });

  describe('send', () => {
    it('appends to an existing thread and can be un-appended', async () => {
      const provider = fresh();
      const [thread] = await provider.listThreads('inbox');
      const before = thread.messages.length;

      const sent = await provider.send({
        to: [{ name: 'Dana', email: 'dana@lumenpartners.com' }],
        cc: [],
        bcc: [],
        subject: thread.subject,
        body: 'On my way.',
        threadId: thread.id,
      });

      expect((await provider.getThread(thread.id)).messages).toHaveLength(before + 1);

      await provider.unsend(sent.id);
      expect((await provider.getThread(thread.id)).messages).toHaveLength(before);
    });

    it('refuses a message with no recipient', async () => {
      await expect(
        fresh().send({ to: [], cc: [], bcc: [], subject: 'x', body: 'y' }),
      ).rejects.toThrow(/didn't accept this message/);
    });
  });

  describe('search', () => {
    it('needs at least 2 characters (§5.11)', async () => {
      const results = await fresh().search('a', false);
      expect(results.inbox).toHaveLength(0);
    });

    it('covers inbox and archive, and excludes held unless asked (D12)', async () => {
      const provider = fresh();
      const without = await provider.search('atlas', false);
      const withHeld = await provider.search('atlas', true);

      expect(without.held).toHaveLength(0);
      expect(without.inbox.length + without.archive.length).toBeGreaterThan(0);
      expect(withHeld.held.length).toBeGreaterThan(0);
    });

    it('matches sender names as well as bodies', async () => {
      const results = await fresh().search('Whitlock', false);
      expect(results.inbox.length).toBeGreaterThan(0);
    });
  });

  it('persists decisions across instances', async () => {
    const provider = fresh();
    const [first] = await provider.listHeld();
    await provider.decideSender(first.sender.id, 'declined');

    const reloaded = new MockMailProvider();
    expect((await reloaded.listSenders('declined')).some((s) => s.id === first.sender.id)).toBe(
      true,
    );
  });
});
