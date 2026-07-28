import { describe, expect, it } from 'vitest';
import { conversationText } from '../useMailAnswer';
import type { Message, Thread } from '../../types';

function message(over: Partial<Message>): Message {
  return {
    id: 'm',
    threadId: 't1',
    from: { name: 'Dana Whitlock', email: 'dana@lumenpartners.com' },
    to: [],
    cc: [],
    subject: 'Contract redlines',
    body: '',
    date: '2026-07-24T09:14:00.000Z',
    isFromUser: false,
    attachments: [],
    ...over,
  };
}

function thread(messages: Message[]): Thread {
  return {
    id: 't1',
    subject: 'Contract redlines back from legal',
    place: 'inbox',
    unread: false,
    lastMessageAt: '2026-07-28T12:33:00.000Z',
    messages,
  };
}

/**
 * The bug this exists for: the bodies were concatenated with nothing between
 * them, so a four-message thread reached the model as one voice. "What did I
 * promise Dana about the liability cap" was answered "Not in this mail." on a
 * thread that said, in the reader's own words, that they would decide it.
 */
describe('conversationText', () => {
  it('attributes every message', () => {
    const text = conversationText(
      thread([
        message({ id: 'm1', body: 'The cap moved to $500K.' }),
        message({ id: 'm2', isFromUser: true, body: "I'll decide the cap by end of day." }),
      ]),
    );

    expect(text).toContain('Dana Whitlock: The cap moved to $500K.');
    expect(text).toContain("You: I'll decide the cap by end of day.");
  });

  /* "You", because that is how the question will be phrased. */
  it('calls the reader You rather than by name', () => {
    const text = conversationText(
      thread([message({ isFromUser: true, from: { name: 'Marc Ferrum', email: 'marc@x.io' }, body: 'Noted.' })]),
    );
    expect(text).toBe('You: Noted.');
    expect(text).not.toContain('Marc Ferrum');
  });

  /*
   * Newest first, because the prompt truncates from the end and the oldest
   * message is the least likely to hold the answer.
   */
  it('puts the newest message first', () => {
    const text = conversationText(
      thread([
        message({ id: 'm1', body: 'oldest' }),
        message({ id: 'm2', body: 'middle' }),
        message({ id: 'm3', body: 'newest' }),
      ]),
    );
    expect(text.indexOf('newest')).toBeLessThan(text.indexOf('oldest'));
  });

  it('survives a message with no body', () => {
    const text = conversationText(thread([message({ body: undefined as unknown as string })]));
    expect(text).toBe('Dana Whitlock:');
  });

  it('separates speakers so two messages never read as one', () => {
    const text = conversationText(
      thread([
        message({ id: 'm1', body: 'first' }),
        message({ id: 'm2', isFromUser: true, body: 'second' }),
      ]),
    );
    expect(text).toBe('You: second\n\nDana Whitlock: first');
  });
});
