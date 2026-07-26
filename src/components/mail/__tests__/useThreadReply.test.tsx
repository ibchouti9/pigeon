import { describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useThreadReply } from '../useThreadReply';
import type { Thread } from '../../../types';

/**
 * A reply belongs to the thread it was opened on. Nothing cleared it when the
 * reader moved, so opening a reply on one thread and then opening another
 * showed a composer nobody asked for on the second — and if the first had been
 * opened with ⌘J, `draftWithPigeon` was still set, so the new one immediately
 * asked Pigeon for a draft of a thread the user had only just arrived at.
 */
function makeThread(id: string): Thread {
  return {
    id,
    subject: `Subject ${id}`,
    place: 'inbox',
    unread: false,
    lastMessageAt: '2026-07-20T09:00:00.000Z',
    messages: [],
  };
}

describe('useThreadReply', () => {
  it('closes the reply when the reader moves to another thread', () => {
    const { result, rerender } = renderHook(({ thread }) => useThreadReply(thread, true), {
      initialProps: { thread: makeThread('t1') },
    });

    act(() => result.current.open('reply'));
    expect(result.current.mode).toBe('reply');
    expect(result.current.slot).toBeTruthy();

    rerender({ thread: makeThread('t2') });

    expect(result.current.mode).toBeNull();
    expect(result.current.slot).toBeUndefined();
  });

  it('keeps it open while the reader stays put', () => {
    const thread = makeThread('t1');
    const { result, rerender } = renderHook(({ thread }) => useThreadReply(thread, true), {
      initialProps: { thread },
    });

    act(() => result.current.open('forward'));
    // A re-render with an equal thread is not a move.
    rerender({ thread: makeThread('t1') });

    expect(result.current.mode).toBe('forward');
  });

  it('does not open one at all while offline (D21)', () => {
    const { result } = renderHook(() => useThreadReply(makeThread('t1'), false));

    act(() => result.current.open('reply'));

    expect(result.current.mode).toBeNull();
  });
});
