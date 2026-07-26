import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { useMail } from '../../../store/mail';
import { useCompose } from '../../../store/compose';
import { MockMailProvider } from '../../../data/mock/mockProvider';
import { ComposeDock } from '../ComposeDock';

/**
 * §8.1 exempts ⌘Enter and ⌘J from the rule that shortcuts are disabled inside
 * a text field, so both belong to the whole composer. They were bound to the
 * body editor alone: ⌘Enter sent from the message but did nothing from the
 * Subject line or the recipient field, where someone finishing a short reply
 * is just as likely to be.
 */
describe('⌘Enter sends from anywhere in the composer (§8.1)', () => {
  let provider: MockMailProvider;

  beforeEach(() => {
    localStorage.clear();
    MockMailProvider.reset();
    provider = new MockMailProvider();
    useMail.getState().setProvider(provider);
    useCompose.getState().close();
  });

  afterEach(cleanup);

  /*
   * `useCompose` is a module singleton, so a send still running at the end of a
   * test resolves inside the next one and closes the draft it is working on —
   * emptying the DOM mid-assertion. Waiting for the composer to close is also
   * §3.4's own behaviour, so it is worth asserting rather than merely awaiting.
   */
  async function expectSent(send: ReturnType<typeof vi.spyOn>) {
    await waitFor(() => expect(send).toHaveBeenCalled());
    await waitFor(() => expect(useCompose.getState().draft).toBeNull());
  }

  async function openDraft(user: ReturnType<typeof userEvent.setup>) {
    render(
      <MemoryRouter>
        <ComposeDock />
      </MemoryRouter>,
    );
    useCompose.getState().open();

    const to = await screen.findByPlaceholderText('Recipients');
    await user.type(to, 'dana@lumenpartners.com{Enter}');
    await user.type(screen.getByLabelText('Message body'), 'Body text.');
    return { to, subject: document.querySelector<HTMLInputElement>('input[id$="-subject"]')! };
  }

  it('sends from the Subject line', async () => {
    const user = userEvent.setup();
    const send = vi.spyOn(provider, 'send');
    const { subject } = await openDraft(user);

    await user.click(subject);
    await user.keyboard('{Meta>}{Enter}{/Meta}');

    await expectSent(send);
  });

  it('sends from the recipient field', async () => {
    const user = userEvent.setup();
    const send = vi.spyOn(provider, 'send');
    const { to } = await openDraft(user);

    await user.click(to);
    await user.keyboard('{Meta>}{Enter}{/Meta}');

    await expectSent(send);
  });

  it('still sends from the message body', async () => {
    const user = userEvent.setup();
    const send = vi.spyOn(provider, 'send');
    await openDraft(user);

    await user.click(screen.getByLabelText('Message body'));
    await user.keyboard('{Meta>}{Enter}{/Meta}');

    await expectSent(send);
  });

  it('does not send on a bare Enter in the Subject line', async () => {
    const user = userEvent.setup();
    const send = vi.spyOn(provider, 'send');
    const { subject } = await openDraft(user);

    await user.click(subject);
    await user.keyboard('{Enter}');

    // §5.12 binds send to ⌘Enter. A lone text input in a form submits it on
    // Enter, so leaving the subject line used to send the message.
    expect(send).not.toHaveBeenCalled();
    useCompose.getState().close();
  });
});
