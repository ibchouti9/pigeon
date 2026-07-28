import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useMail } from '../mail';
import { MockMailProvider } from '../../data/mock/mockProvider';
import type { Thread } from '../../types';

/**
 * `markRead` took a boolean the whole way down to the provider and the store
 * dropped it, hardcoding `true`. The reader's 1,200ms timer was the only
 * writer, so "leave this unread and come back to it" — the move most of
 * Gmail's triage rests on — could not be expressed at all.
 */
describe('marking a thread unread', () => {
  beforeEach(() => {
    localStorage.clear();
    MockMailProvider.reset();
    useMail.getState().setProvider(new MockMailProvider());
  });

  function seed(unread: boolean): Thread {
    const thread: Thread = {
      id: 't1',
      subject: 'Contract redlines',
      place: 'inbox',
      unread,
      messages: [],
      lastMessageAt: '2026-07-20T10:00:00.000Z',
    };
    useMail.setState({ inbox: [thread] });
    return thread;
  }

  it('puts a read thread back to unread', async () => {
    seed(false);
    const write = vi.spyOn(useMail.getState().provider, 'markRead').mockResolvedValue();

    await useMail.getState().markRead('t1', false);

    expect(useMail.getState().inbox[0].unread).toBe(true);
    expect(write).toHaveBeenCalledWith('t1', false);
  });

  it('still defaults to marking read, which is what the reader asks for', async () => {
    seed(true);
    const write = vi.spyOn(useMail.getState().provider, 'markRead').mockResolvedValue();

    await useMail.getState().markRead('t1');

    expect(useMail.getState().inbox[0].unread).toBe(false);
    expect(write).toHaveBeenCalledWith('t1', true);
  });

  it('sends nothing when the thread is already in that state', async () => {
    seed(true);
    const write = vi.spyOn(useMail.getState().provider, 'markRead').mockResolvedValue();

    await useMail.getState().markRead('t1', false);

    expect(write).not.toHaveBeenCalled();
  });

  it('rolls the row back when the provider refuses', async () => {
    seed(false);
    vi.spyOn(useMail.getState().provider, 'markRead').mockRejectedValue(new Error('nope'));

    await useMail.getState().markRead('t1', false);

    expect(useMail.getState().inbox[0].unread).toBe(false);
  });
});
