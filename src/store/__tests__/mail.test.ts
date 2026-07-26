import { beforeEach, describe, expect, it } from 'vitest';
import { useMail } from '../mail';
import { useToasts } from '../toast';
import { MockMailProvider } from '../../data/mock/mockProvider';

async function freshStore() {
  localStorage.clear();
  MockMailProvider.reset();
  useToasts.setState({ toasts: [] });
  useMail.getState().setProvider(new MockMailProvider());
  await useMail.getState().loadAccount();
  await Promise.all([
    useMail.getState().loadThreads('inbox'),
    useMail.getState().loadHeld(),
    useMail.getState().loadSenders(),
  ]);
}

/** Runs the newest toast's action, the way clicking Undo does. */
async function runUndo() {
  const toast = useToasts.getState().toasts.find((t) => t.action);
  expect(toast, 'expected an undo toast').toBeDefined();
  await toast!.action!.run();
}

describe('useMail', () => {
  beforeEach(freshStore);

  describe('decide', () => {
    it('approves a sender and offers undo with the §7.5 copy', async () => {
      const first = useMail.getState().held[0];
      await useMail.getState().decide(first.sender.id, 'approved');

      const toast = useToasts.getState().toasts[0];
      expect(toast.message).toBe(`Approved ${first.sender.name}. Their mail is in your inbox.`);
      expect(toast.action?.label).toBe('Undo');
      expect(toast.duration).toBe(8000);
    });

    it('names the address, not the person, when declining (§7.5)', async () => {
      const first = useMail.getState().held[0];
      await useMail.getState().decide(first.sender.id, 'declined');
      expect(useToasts.getState().toasts[0].message).toBe(
        `Declined ${first.sender.email}. You won't see their mail.`,
      );
    });

    it('returns the sender to the Screener on undo', async () => {
      const first = useMail.getState().held[0];
      const before = useMail.getState().held.length;

      await useMail.getState().decide(first.sender.id, 'approved');
      expect(useMail.getState().held).toHaveLength(before - 1);

      await runUndo();

      expect(useMail.getState().held).toHaveLength(before);
      expect(useMail.getState().held.some((h) => h.sender.id === first.sender.id)).toBe(true);
    });
  });

  describe('decideMany', () => {
    it('declines a set and offers one grouped undo (D37)', async () => {
      const ids = useMail.getState().held.slice(0, 3).map((h) => h.sender.id);
      const before = useMail.getState().held.length;

      await useMail.getState().decideMany(ids, 'declined');

      expect(useMail.getState().held).toHaveLength(before - 3);
      const toast = useToasts.getState().toasts[0];
      expect(toast.message).toBe("Declined 3 senders. You won't see their mail.");
      expect(toast.action?.label).toBe('Undo all');
    });

    it('restores every sender in the group on undo', async () => {
      const ids = useMail.getState().held.slice(0, 3).map((h) => h.sender.id);
      const before = useMail.getState().held.length;

      await useMail.getState().decideMany(ids, 'declined');
      await runUndo();

      expect(useMail.getState().held).toHaveLength(before);
      for (const id of ids) {
        expect(useMail.getState().held.some((h) => h.sender.id === id)).toBe(true);
      }
      expect(useMail.getState().declined.some((s) => ids.includes(s.id))).toBe(false);
    });

    it('confirms the undo (§7.5)', async () => {
      const ids = useMail.getState().held.slice(0, 2).map((h) => h.sender.id);
      await useMail.getState().decideMany(ids, 'approved');
      await runUndo();
      expect(useToasts.getState().toasts.some((t) => t.message === 'Decision undone.')).toBe(true);
    });
  });

  describe('setPlace', () => {
    it('archives with undo, and undo puts it back', async () => {
      const thread = useMail.getState().inbox[0];
      await useMail.getState().setPlace(thread.id, 'archive');

      expect(useMail.getState().inbox.some((t) => t.id === thread.id)).toBe(false);
      expect(useToasts.getState().toasts[0].message).toBe('Archived.');

      await runUndo();
      await useMail.getState().loadThreads('inbox');
      expect(useMail.getState().inbox.some((t) => t.id === thread.id)).toBe(true);
    });
  });

  describe('reverse', () => {
    it('moves a sender between the approved and declined lists', async () => {
      const first = useMail.getState().held[0];
      await useMail.getState().decide(first.sender.id, 'approved');

      await useMail.getState().reverse(first.sender.id, 'declined');

      expect(useMail.getState().declined.some((s) => s.id === first.sender.id)).toBe(true);
      expect(useToasts.getState().toasts[0].message).toBe(
        `Declined ${first.sender.name}. Their mail stays in your inbox; new mail stops.`,
      );
    });
  });
});
