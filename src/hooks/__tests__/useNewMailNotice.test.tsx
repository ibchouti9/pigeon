import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useNewMailNotice } from '../useNewMailNotice';
import { useMail } from '../../store/mail';
import type { Thread } from '../../types';

const notify = vi.fn();
const mayNotify = vi.fn(async () => true);

vi.mock('../../lib/notify', () => ({
  mayNotify: () => mayNotify(),
  notify: (notice: unknown) => {
    notify(notice);
    return Promise.resolve();
  },
}));

function thread(id: string, from: string, subject: string, unread = true): Thread {
  return {
    id,
    subject,
    place: 'inbox',
    unread,
    lastMessageAt: '2026-07-28T09:00:00.000Z',
    messages: [
      {
        id: `${id}-m1`,
        threadId: id,
        from: { name: from, email: `${from.toLowerCase().replace(/\s+/g, '.')}@example.com` },
        to: [],
        cc: [],
        subject,
        body: 'hello',
        date: '2026-07-28T09:00:00.000Z',
        isFromUser: false,
        attachments: [],
      },
    ],
  };
}

/** Puts a listing on the store the way a finished refresh would. */
function listing(threads: Thread[]) {
  act(() => {
    useMail.setState((s) => ({ inbox: threads, status: { ...s.status, inbox: 'ready' } }));
  });
}

/**
 * The permission check is a promise, so the notification lands a microtask
 * after the listing that caused it — asserting straight after `listing` reads
 * the mock before it has been called.
 */
async function settle() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('useNewMailNotice', () => {
  beforeEach(() => {
    notify.mockClear();
    mayNotify.mockClear();
    act(() => {
      useMail.setState((s) => ({ inbox: [], status: { ...s.status, inbox: 'idle' } }));
    });
  });

  /*
   * The rule that matters most. Without it, opening Pigeon notifies you about
   * every unread conversation you already knew about — one per thread, at
   * launch, every launch.
   */
  it('treats the first listing as a baseline, not as news', async () => {
    renderHook(() => useNewMailNotice());
    listing([thread('t1', 'Dana Whitlock', 'Contract redlines')]);
    await settle();
    expect(notify).not.toHaveBeenCalled();
  });

  it('notifies for a thread that was not in the previous listing', async () => {
    renderHook(() => useNewMailNotice());
    listing([thread('t1', 'Dana Whitlock', 'Contract redlines')]);
    listing([
      thread('t2', 'Priya Raman', 'Reconcile window change'),
      thread('t1', 'Dana Whitlock', 'Contract redlines'),
    ]);
    await settle();

    expect(notify).toHaveBeenCalledOnce();
    expect(notify).toHaveBeenCalledWith({
      title: 'Priya Raman',
      body: 'Reconcile window change',
    });
  });

  /* Five arrivals must not be five notifications. */
  it('summarises a batch into one', async () => {
    renderHook(() => useNewMailNotice());
    listing([thread('t0', 'Dana Whitlock', 'Contract redlines')]);
    listing([
      thread('t0', 'Dana Whitlock', 'Contract redlines'),
      thread('t1', 'Priya Raman', 'One'),
      thread('t2', 'Jae Doss', 'Two'),
      thread('t3', 'Ellis Vance', 'Three'),
      thread('t4', 'Ines Carvalho', 'Four'),
    ]);
    await settle();

    expect(notify).toHaveBeenCalledOnce();
    expect(notify).toHaveBeenCalledWith({
      title: '4 new messages',
      body: 'Priya Raman, Jae Doss, Ellis Vance and 1 more',
    });
  });

  /* A thread already listed getting a reply is not a thread arriving. */
  it('says nothing when a known thread merely changes', async () => {
    renderHook(() => useNewMailNotice());
    const one = thread('t1', 'Dana Whitlock', 'Contract redlines');
    listing([one]);
    listing([{ ...one, subject: 'Contract redlines', unread: true }]);
    await settle();
    expect(notify).not.toHaveBeenCalled();
  });

  /*
   * Restoring a thread from the archive puts a row in the inbox that is new to
   * this list and is not new mail. It arrives read, which is what separates
   * the two.
   */
  it('says nothing about a thread that arrives already read', async () => {
    renderHook(() => useNewMailNotice());
    listing([thread('t1', 'Dana Whitlock', 'Contract redlines')]);
    listing([
      thread('t1', 'Dana Whitlock', 'Contract redlines'),
      thread('t2', 'Jae Doss', 'Office keys', false),
    ]);
    await settle();
    expect(notify).not.toHaveBeenCalled();
  });

  it('posts nothing when permission is refused', async () => {
    mayNotify.mockResolvedValueOnce(false);
    renderHook(() => useNewMailNotice());
    listing([thread('t1', 'Dana Whitlock', 'Contract redlines')]);
    listing([
      thread('t1', 'Dana Whitlock', 'Contract redlines'),
      thread('t2', 'Priya Raman', 'Reconcile'),
    ]);

    await settle();
    expect(notify).not.toHaveBeenCalled();
  });
});
