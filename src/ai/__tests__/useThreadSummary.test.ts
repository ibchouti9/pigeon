import { beforeEach, describe, expect, it } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useThreadSummary, shouldAutoSummarize } from '../useThreadSummary';
import { useSettings } from '../../store/settings';
import { useMail } from '../../store/mail';
import { MockMailProvider } from '../../data/mock/mockProvider';
import type { Message, Thread } from '../../types';

function message(id: string, body: string): Message {
  return {
    id,
    threadId: 't1',
    from: { name: 'Dana Whitlock', email: 'dana@lumenpartners.com' },
    to: [{ name: '', email: 'marc@ferrum.dev' }],
    cc: [],
    subject: 'Contract redlines',
    body,
    date: new Date().toISOString(),
    attachments: [],
    isFromUser: false,
  };
}

function thread(unread: boolean): Thread {
  return {
    id: 't1',
    subject: 'Contract redlines',
    place: 'inbox',
    unread,
    messages: ['a', 'b', 'c', 'd'].map((id) => message(id, 'Something happened.')),
    lastMessageAt: new Date().toISOString(),
  };
}

describe('shouldAutoSummarize (D5)', () => {
  it('summarizes at four messages', () => {
    expect(shouldAutoSummarize(thread(false))).toBe(true);
  });

  it('does not summarize a short thread', () => {
    const short = { ...thread(false), messages: [message('a', 'Hi.')] };
    expect(shouldAutoSummarize(short)).toBe(false);
  });

  it('summarizes a long two-message thread on word count', () => {
    const wordy = {
      ...thread(false),
      messages: [message('a', 'word '.repeat(700)), message('b', 'word '.repeat(700))],
    };
    expect(shouldAutoSummarize(wordy)).toBe(true);
  });
});

describe('useThreadSummary', () => {
  beforeEach(() => {
    localStorage.clear();
    MockMailProvider.reset();
    useMail.getState().setProvider(new MockMailProvider());
    useSettings.setState({
      provider: {
        provider: 'demo',
        apiKey: '',
        baseUrl: 'http://localhost:11434',
        model: 'demo',
      },
      behaviour: { autoSummarize: true, screenerReads: true, matchWritingStyle: true },
    });
  });

  /**
   * Marking a thread read replaces it in the store with `{ ...t, unread: false }`
   * — a new object, same id — 1.2 seconds after it opens. An effect keyed on the
   * object threw away the finished summary and regenerated it, so every eligible
   * unread thread flashed a second after the reader appeared.
   */
  it('does not regenerate when the thread object changes but its id does not', async () => {
    const v1 = thread(true);
    const { result, rerender } = renderHook(({ t }: { t: Thread }) => useThreadSummary(t), {
      initialProps: { t: v1 },
    });

    await waitFor(() => expect(result.current.state).toBe('ready'), { timeout: 3000 });
    const bullets = result.current.bullets;
    expect(bullets.length).toBeGreaterThan(0);

    // What markRead does: same id, new object.
    rerender({ t: { ...v1, unread: false } });

    expect(result.current.state).toBe('ready');
    expect(result.current.bullets).toEqual(bullets);
  });

  it('does regenerate when the id changes', async () => {
    const { result, rerender } = renderHook(({ t }: { t: Thread }) => useThreadSummary(t), {
      initialProps: { t: thread(true) },
    });
    await waitFor(() => expect(result.current.state).toBe('ready'), { timeout: 3000 });

    rerender({ t: { ...thread(true), id: 't2' } });
    expect(result.current.state).not.toBe('ready');

    await waitFor(() => expect(result.current.state).toBe('ready'), { timeout: 3000 });
  });

  it('stays idle below the threshold, offering the button instead (D5)', () => {
    const short = { ...thread(false), messages: [message('a', 'Hi.')] };
    const { result } = renderHook(() => useThreadSummary(short));
    expect(result.current.state).toBe('idle');
    expect(result.current.offersButton).toBe(true);
  });

  it('does nothing when the behaviour toggle is off (§5.13c)', () => {
    useSettings.setState({
      behaviour: { autoSummarize: false, screenerReads: true, matchWritingStyle: true },
    });
    const { result } = renderHook(() => useThreadSummary(thread(true)));
    expect(result.current.state).toBe('idle');
  });
});
