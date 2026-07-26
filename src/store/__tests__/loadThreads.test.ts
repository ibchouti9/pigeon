import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useMail } from '../mail';
import { MockMailProvider } from '../../data/mock/mockProvider';
import type { Thread } from '../../types';

/**
 * `loadThreads` awaited the whole walk before the screen left its skeleton. On
 * a real 2,000-thread archive that is ~50 seconds at best and around thirteen
 * minutes once Gmail's quota throttles it. The provider publishes each page as
 * it lands; this is the layer that has to listen — and when the provider was
 * taught to publish, nothing here checked that anything was hearing it.
 */
describe('loadThreads shows pages as they arrive', () => {
  beforeEach(() => {
    localStorage.clear();
    MockMailProvider.reset();
    useMail.getState().setProvider(new MockMailProvider());
    useMail.setState((s) => ({ inbox: [], status: { ...s.status, inbox: 'idle' } }));
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

  it('leaves the loading state on the first page, not the last', async () => {
    let release: () => void = () => {};
    const finished = new Promise<void>((r) => (release = r));

    vi.spyOn(useMail.getState().provider, 'listThreads').mockImplementation(
      async (_place, onPage) => {
        onPage?.([thread('a')]);
        await finished;
        return [thread('a'), thread('b')];
      },
    );

    const loading = useMail.getState().loadThreads('inbox');

    // One page in, with the walk still running.
    await vi.waitFor(() => expect(useMail.getState().status.inbox).toBe('ready'));
    expect(useMail.getState().inbox).toHaveLength(1);

    release();
    await loading;
    expect(useMail.getState().inbox).toHaveLength(2);
  });

  it('does not flash the empty state on a page that filtered down to nothing', async () => {
    let release: () => void = () => {};
    const finished = new Promise<void>((r) => (release = r));

    vi.spyOn(useMail.getState().provider, 'listThreads').mockImplementation(
      async (_place, onPage) => {
        // §2.3 hides held senders, so an early page can be entirely filtered
        // out while thousands of threads are still to come.
        onPage?.([]);
        await finished;
        return [thread('a')];
      },
    );

    const loading = useMail.getState().loadThreads('inbox');
    await vi.waitFor(() => expect(useMail.getState().status.inbox).toBe('loading'));
    expect(useMail.getState().status.inbox).toBe('loading');

    release();
    await loading;
    expect(useMail.getState().status.inbox).toBe('ready');
  });

  it('still reaches the empty state for a mailbox that really is empty', async () => {
    vi.spyOn(useMail.getState().provider, 'listThreads').mockResolvedValue([]);

    await useMail.getState().loadThreads('inbox');

    expect(useMail.getState().status.inbox).toBe('ready');
    expect(useMail.getState().inbox).toEqual([]);
  });

  it('ignores pages from a provider the user has since swapped away from', async () => {
    let publish: ((threads: Thread[]) => void) | undefined;
    let release: () => void = () => {};
    const finished = new Promise<void>((r) => (release = r));

    vi.spyOn(useMail.getState().provider, 'listThreads').mockImplementation(
      async (_place, onPage) => {
        publish = onPage;
        await finished;
        return [];
      },
    );

    const loading = useMail.getState().loadThreads('inbox');
    // Disconnecting mid-walk is exactly when a stale page would land on the
    // new account's inbox.
    useMail.getState().setProvider(new MockMailProvider());

    publish?.([thread('stale')]);
    release();
    await loading;

    expect(useMail.getState().inbox.some((t) => t.id === 'stale')).toBe(false);
  });
});
