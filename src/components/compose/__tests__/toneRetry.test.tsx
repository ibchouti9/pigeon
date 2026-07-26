import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { useMail } from '../../../store/mail';
import { useCompose } from '../../../store/compose';
import { MockMailProvider } from '../../../data/mock/mockProvider';
import { ComposeDock } from '../ComposeDock';

/**
 * §3.4 4a — a tone chip rewrites the draft, and §7.6 gives one error line for
 * every drafting failure: "Pigeon couldn't write a draft. Write your reply, or
 * try again."
 *
 * That error's "Try again" always regenerated a whole fresh draft. So when a
 * *tone change* failed, the button offered to throw away everything the user
 * had written and replace it with a new generation — the one thing this error
 * must not do, since the draft is the work being protected.
 */

/** One client object for the life of the module; see rateLimited.test.ts. */
const stub = vi.hoisted(() => {
  const calls = { retone: 0, draftReply: 0 };
  const behaviour = { failRetone: true, failDraft: false };
  return {
    calls,
    behaviour,
    assistant: {
      connected: true,
      client: {
        provider: 'anthropic',
        summarizeThread: () => Promise.resolve([]),
        readSender: () => Promise.resolve(''),
        digest: () => Promise.resolve(''),
        draftReply: () => {
          calls.draftReply += 1;
          if (behaviour.failDraft) return Promise.reject(new Error('nope'));
          return Promise.resolve('A whole new draft from scratch.');
        },
        retone: (body: string) => {
          calls.retone += 1;
          if (behaviour.failRetone) return Promise.reject(new Error('nope'));
          return Promise.resolve(`${body} (friendlier)`);
        },
      },
    },
    flags: { autoSummarize: true, screenerReads: true, matchWritingStyle: false },
  };
});

vi.mock('../../../ai/useAssistant', () => ({
  useAssistant: () => stub.assistant,
  useBehaviour: () => stub.flags,
}));

const DRAFTED = 'A whole new draft from scratch.';
const OWN_WORDS = ' And my own words.';

describe('retrying a failed tone change (§3.4 4a)', () => {
  beforeEach(() => {
    localStorage.clear();
    MockMailProvider.reset();
    useMail.getState().setProvider(new MockMailProvider());
    useCompose.getState().close();
    stub.calls.retone = 0;
    stub.calls.draftReply = 0;
    stub.behaviour.failRetone = true;
    stub.behaviour.failDraft = false;
  });

  /**
   * §5.12 shows the tone chips only once there is an AI draft, so the sequence
   * that matters is: draft with Pigeon, edit it, then ask for a tone change.
   * The user's edits are what a regenerating retry would destroy.
   */
  async function draftThenEdit(user: ReturnType<typeof userEvent.setup>) {
    render(
      <MemoryRouter>
        <ComposeDock />
      </MemoryRouter>,
    );
    useCompose.getState().open({ to: [{ name: 'Dana', email: 'dana@lumen.com' }] });
    const editor = (await screen.findByLabelText('Message body')) as HTMLTextAreaElement;

    await user.click(screen.getByRole('button', { name: /Draft with Pigeon/ }));
    await waitFor(() => expect(editor.value).toBe(DRAFTED));

    await user.type(editor, OWN_WORDS);
    expect(editor.value).toBe(`${DRAFTED}${OWN_WORDS}`);
    return editor;
  }

  async function failATone(user: ReturnType<typeof userEvent.setup>) {
    const editor = await draftThenEdit(user);
    await user.click(await screen.findByRole('button', { name: /Friendlier/ }));
    await screen.findByText(
      "Pigeon couldn't write a draft. Write your reply, or try again.",
    );
    return editor;
  }

  it('retries the tone, not a whole new draft', async () => {
    const user = userEvent.setup();
    await failATone(user);
    expect(stub.calls.retone).toBe(1);
    expect(stub.calls.draftReply).toBe(1);

    await user.click(screen.getByRole('button', { name: 'Try again' }));

    await waitFor(() => expect(stub.calls.retone).toBe(2));
    expect(stub.calls.draftReply, 'Try again regenerated the draft instead').toBe(1);
  });

  it('keeps what the user wrote when the retry succeeds', async () => {
    const user = userEvent.setup();
    const editor = await failATone(user);

    stub.behaviour.failRetone = false;
    await user.click(screen.getByRole('button', { name: 'Try again' }));

    await waitFor(() => expect(editor.value).toBe(`${DRAFTED}${OWN_WORDS} (friendlier)`));
  });

  /**
   * A tone failure leaves a note of which tone to repeat. If a later *draft*
   * fails, that note is stale and its "Try again" would rewrite the tone of a
   * draft the user never got.
   */
  it('forgets the failed tone once a new draft is attempted', async () => {
    const user = userEvent.setup();
    await failATone(user);
    expect(stub.calls.retone).toBe(1);

    stub.behaviour.failDraft = true;
    await user.click(screen.getByRole('button', { name: /Draft with Pigeon/ }));
    await waitFor(() => expect(stub.calls.draftReply).toBe(2));

    await user.click(screen.getByRole('button', { name: 'Try again' }));

    await waitFor(() => expect(stub.calls.draftReply).toBe(3));
    expect(stub.calls.retone, 'Try again retoned after a draft failure').toBe(1);
  });

  /**
   * Two rewrites at once would leave the later one holding a "previous body"
   * the earlier had already replaced, so Undo would restore text the user never
   * wrote. The tone chips guard the same way.
   */
  it('does not run two retries at once', async () => {
    const user = userEvent.setup();
    await failATone(user);
    expect(stub.calls.retone).toBe(1);

    let release: (v: string) => void = () => {};
    stub.behaviour.failRetone = false;
    const held = new Promise<string>((r) => (release = r));
    const retone = stub.assistant.client.retone;
    stub.assistant.client.retone = () => {
      stub.calls.retone += 1;
      return held;
    };

    const tryAgain = screen.getByRole('button', { name: 'Try again' });
    await user.click(tryAgain);
    await waitFor(() => expect(stub.calls.retone).toBe(2));

    // Both retry paths clear the error on entry, so the block and its button
    // are gone before a second click is possible. That, not a disabled
    // attribute, is what stops two rewrites running at once.
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();

    release('done');
    await waitFor(() => expect(stub.calls.retone).toBe(2));
    stub.assistant.client.retone = retone;
  });

  it('still regenerates when it was the draft itself that failed', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <ComposeDock />
      </MemoryRouter>,
    );
    useCompose.getState().open({ to: [{ name: 'Dana', email: 'dana@lumen.com' }] });
    await screen.findByLabelText('Message body');

    stub.behaviour.failDraft = true;
    await user.click(screen.getByRole('button', { name: /Draft with Pigeon/ }));
    await screen.findByText(
      "Pigeon couldn't write a draft. Write your reply, or try again.",
    );
    expect(stub.calls.draftReply).toBe(1);

    // Nothing has been written yet, so a whole fresh draft is the right retry.
    await user.click(screen.getByRole('button', { name: 'Try again' }));

    await waitFor(() => expect(stub.calls.draftReply).toBe(2));
    expect(stub.calls.retone).toBe(0);
  });
});
