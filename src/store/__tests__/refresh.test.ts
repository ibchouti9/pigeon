import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useMail } from '../mail';
import { MockMailProvider } from '../../data/mock/mockProvider';
import { MailError } from '../../data/provider';
import type { Thread } from '../../types';

/**
 * The shell fetched the inbox once at mount and nothing ever fetched it again,
 * so mail that arrived while Pigeon was open never appeared. `refresh` is the
 * background read that fixes it, and every assertion here is about what it
 * must *not* do: a poll running behind someone who is reading has to be
 * invisible when it works and harmless when it fails.
 */
describe('refresh', () => {
  beforeEach(() => {
    localStorage.clear();
    MockMailProvider.reset();
    useMail.getState().setProvider(new MockMailProvider());
  });

  function thread(id: string): Thread {
    return {
      id,
      subject: `Subject ${id}`,
      place: 'inbox',
      unread: false,
      messages: [],
      lastMessageAt: '2026-07-20T10:00:00.000Z',
    };
  }

  function settle(inbox: Thread[]) {
    useMail.setState((s) => ({
      inbox,
      status: { ...s.status, inbox: 'ready', held: 'ready' },
    }));
  }

  it('never puts the place back into its loading state', async () => {
    settle([thread('a')]);
    const seen: string[] = [];
    const unsubscribe = useMail.subscribe((s) => seen.push(s.status.inbox));

    await useMail.getState().refresh();
    unsubscribe();

    expect(seen).not.toContain('loading');
  });

  it('publishes mail that arrived since the last read', async () => {
    settle([thread('a')]);
    vi.spyOn(useMail.getState().provider, 'listThreads').mockResolvedValue([
      thread('new'),
      thread('a'),
    ]);

    await useMail.getState().refresh();

    expect(useMail.getState().inbox.map((t) => t.id)).toEqual(['new', 'a']);
  });

  it('leaves a working screen alone when the read fails', async () => {
    settle([thread('a')]);
    vi.spyOn(useMail.getState().provider, 'listThreads').mockRejectedValue(
      new MailError('down', 'unreachable'),
    );

    await expect(useMail.getState().refresh()).resolves.toBeUndefined();

    expect(useMail.getState().inbox.map((t) => t.id)).toEqual(['a']);
    expect(useMail.getState().status.inbox).toBe('ready');
  });

  it('heals a place whose first load failed', async () => {
    useMail.setState((s) => ({ inbox: [], status: { ...s.status, inbox: 'error' } }));
    vi.spyOn(useMail.getState().provider, 'listThreads').mockResolvedValue([thread('a')]);

    await useMail.getState().refresh();

    expect(useMail.getState().status.inbox).toBe('ready');
    expect(useMail.getState().inbox).toHaveLength(1);
  });

  it('locks the shell when the background read finds the token revoked', async () => {
    settle([thread('a')]);
    vi.spyOn(useMail.getState().provider, 'listThreads').mockRejectedValue(
      new MailError('gone', 'revoked'),
    );

    await useMail.getState().refresh();

    expect(useMail.getState().revoked).toBe(true);
  });

  it('does not poll a shell that is already locked', async () => {
    settle([thread('a')]);
    useMail.setState({ revoked: true });
    const list = vi.spyOn(useMail.getState().provider, 'listThreads');

    await useMail.getState().refresh();

    expect(list).not.toHaveBeenCalled();
  });

  it('drops a result that belongs to a provider the user has left', async () => {
    settle([thread('a')]);
    vi.spyOn(useMail.getState().provider, 'listThreads').mockImplementation(async () => {
      useMail.getState().setProvider(new MockMailProvider());
      return [thread('stale')];
    });

    await useMail.getState().refresh();

    expect(useMail.getState().inbox.map((t) => t.id)).not.toContain('stale');
  });
});
