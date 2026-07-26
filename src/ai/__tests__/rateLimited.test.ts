import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { AiError } from '../types';
import type { Message, Thread } from '../../types';
import { useThreadSummary } from '../useThreadSummary';

const RATE_LIMIT =
  'Anthropic is rate-limiting Pigeon. Summaries and drafts will come back on their own.';

const failure = vi.hoisted(() => ({ error: new Error('unset') }));

/*
 * One client object, one behaviour object, for the life of the module. The real
 * `useAssistant` memoises on the provider config and `useThreadSummary`'s
 * effect depends on the client — hand it a fresh object per render and the
 * effect re-runs forever. (It cost a heap-exhausted worker to find out.)
 */
const stub = vi.hoisted(() => {
  const reject = () => Promise.reject(failure.error);
  return {
    assistant: {
      connected: true,
      client: {
        provider: 'anthropic',
        summarizeThread: reject,
        readSender: reject,
        digest: reject,
        draftReply: reject,
        retone: reject,
      },
    },
    behaviour: { autoSummarize: true, screenerReads: true, matchStyle: false },
  };
});

vi.mock('../useAssistant', () => ({
  useAssistant: () => stub.assistant,
  useBehaviour: () => stub.behaviour,
}));

function message(id: string): Message {
  return {
    id,
    threadId: 't1',
    from: { name: 'Dana Whitlock', email: 'dana@lumenpartners.com' },
    to: [{ name: '', email: 'marc@ferrum.dev' }],
    cc: [],
    subject: 'Contract redlines',
    body: 'Something happened, and then something else did.',
    date: new Date().toISOString(),
    attachments: [],
    isFromUser: false,
  };
}

/** Four messages clears D5's auto-summary threshold. */
const thread: Thread = {
  id: 't1',
  subject: 'Contract redlines',
  place: 'inbox',
  unread: false,
  messages: ['a', 'b', 'c', 'd'].map(message),
  lastMessageAt: new Date().toISOString(),
};

/**
 * §7.6 gives a rate-limited provider its own line — "Summaries and drafts will
 * come back on their own" — because it means something different from
 * "unavailable": it fixes itself, and retrying now cannot help. The string was
 * written, and thrown by all three remote adapters, but every consumer
 * discarded the error, so the one failure with good news attached read exactly
 * like a hard one.
 */
describe('a rate-limited summary says so (§7.6)', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("surfaces §7.6's line rather than the generic failure", async () => {
    failure.error = new AiError(RATE_LIMIT, 'rate-limited');

    const { result } = renderHook(() => useThreadSummary(thread));

    await waitFor(() => expect(result.current.state).toBe('failed'));
    expect(result.current.failedText).toBe(RATE_LIMIT);
  });

  it("leaves §3.4 2b's default in place for any other failure", async () => {
    failure.error = new AiError('Summary unavailable.');

    const { result } = renderHook(() => useThreadSummary(thread));

    await waitFor(() => expect(result.current.state).toBe('failed'));
    expect(result.current.failedText).toBeNull();
  });

  it('does not mistake a plain Error for a rate limit', async () => {
    failure.error = new Error('socket hang up');

    const { result } = renderHook(() => useThreadSummary(thread));

    await waitFor(() => expect(result.current.state).toBe('failed'));
    expect(result.current.failedText).toBeNull();
  });
});
