import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useMail } from '../../../store/mail';
import { MockMailProvider } from '../../../data/mock/mockProvider';
import type { Thread } from '../../../types';
import { InlineReply } from '../InlineReply';

/**
 * §3.4 step 3 — pressing `r` expands the inline composer and "focus moves into
 * the body field". It didn't: focus stayed on the thread row in the list, so
 * the composer opened and everything typed after it went nowhere. The keyboard
 * path from reading a thread to sending a reply was broken at its first step.
 */
describe('an inline reply takes focus (§3.4)', () => {
  let thread: Thread;

  beforeEach(async () => {
    localStorage.clear();
    MockMailProvider.reset();
    const provider = new MockMailProvider();
    useMail.getState().setProvider(provider);
    await useMail.getState().loadAccount();
    await useMail.getState().loadThreads('inbox');
    thread = useMail.getState().inbox[0];
  });

  afterEach(cleanup);

  it('puts the caret in the body, not on the recipients', async () => {
    render(<InlineReply thread={thread} mode="reply" onClose={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByRole('textbox', { name: 'Message body' })).toHaveFocus();
    });
  });

  it('accepts typing immediately, with no click in between', async () => {
    const user = userEvent.setup();
    render(<InlineReply thread={thread} mode="reply" onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Message body' })).toHaveFocus());

    await user.keyboard('Sounds good.');

    const body = screen.getByRole('textbox', { name: 'Message body' }) as HTMLTextAreaElement;
    expect(body.value).toContain('Sounds good.');
  });

  it('still pre-fills the recipient it is replying to', () => {
    render(<InlineReply thread={thread} mode="reply" onClose={vi.fn()} />);
    const sender = thread.messages.find((m) => !m.isFromUser)!.from;
    expect(screen.getByText(sender.name || sender.email)).toBeInTheDocument();
  });
});
