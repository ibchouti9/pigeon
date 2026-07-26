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

/**
 * The composer sits at the foot of the thread, which on a long one is below the
 * fold, and the reader body is the scroll container. Focus alone did not bring
 * it into view: the composer animates its height open, so for most of that it
 * is a 44px sliver with nothing worth scrolling to.
 */
describe('an inline reply scrolls itself into view (§3.4)', () => {
  let scrollIntoView: ReturnType<typeof vi.fn<Element['scrollIntoView']>>;
  let thread: Thread;

  beforeEach(async () => {
    localStorage.clear();
    MockMailProvider.reset();
    useMail.getState().setProvider(new MockMailProvider());
    await useMail.getState().loadAccount();
    await useMail.getState().loadThreads('inbox');
    thread = useMail.getState().inbox[0];

    scrollIntoView = vi.fn<Element['scrollIntoView']>();
    Element.prototype.scrollIntoView = scrollIntoView;
  });

  afterEach(cleanup);

  it('reveals the body once the expansion ends', async () => {
    const { container } = render(
      <InlineReply thread={thread} mode="reply" onClose={vi.fn()} />,
    );

    container.querySelector('form')?.dispatchEvent(new Event('animationend'));

    await waitFor(() => expect(scrollIntoView).toHaveBeenCalled());
  });

  it('reveals it anyway if the expansion never animates', async () => {
    render(<InlineReply thread={thread} mode="reply" onClose={vi.fn()} />);

    // Reduced motion can skip the animation entirely; the fallback timer runs.
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalled(), { timeout: 2000 });
  });
});

/**
 * A scrolling flex column shrinks its children before it scrolls. On a thread
 * long enough to overflow the reader, that crushed the composer to the 2px of
 * its own border — invisible, on exactly the threads where a reply is most
 * likely, and measurable only in a real browser. This is the CSS that prevents
 * it; jsdom has no layout, so the rule itself is what gets asserted.
 */
describe('the reader body does not crush its children', () => {
  it('declares flex-shrink: 0 on its children', async () => {
    const { readFileSync } = await import('node:fs');
    const css = readFileSync('src/components/mail/ThreadReader.module.css', 'utf8');
    expect(css.replace(/\s+/g, ' ')).toContain('.body > * { flex-shrink: 0; }');
  });
});
