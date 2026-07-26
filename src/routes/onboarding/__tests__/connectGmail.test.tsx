import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { useMail } from '../../../store/mail';
import { MockMailProvider } from '../../../data/mock/mockProvider';
import { AuthError } from '../../../data/gmail/auth';
import { WelcomeRoute } from '../WelcomeRoute';

const auth = vi.hoisted(() => ({
  signIn: vi.fn<() => Promise<void>>(),
  googleClientId: vi.fn<() => string | null>(),
}));

vi.mock('../../../data/gmail/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../data/gmail/auth')>();
  return { ...actual, signIn: auth.signIn, googleClientId: auth.googleClientId };
});

const navigate = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => navigate };
});

/**
 * O1's "Connect Gmail" called `loadAccount()` on whatever provider the store
 * happened to hold — never `signIn()`, never `GmailMailProvider`. The entire
 * real-mail path was unreachable from the UI, and §3.1's branch 2a/2b error
 * blocks could not be produced by anything a user could do.
 */
describe('O1 Connect Gmail (§3.1)', () => {
  beforeEach(() => {
    localStorage.clear();
    MockMailProvider.reset();
    useMail.getState().setProvider(new MockMailProvider());
    auth.signIn.mockReset();
    auth.googleClientId.mockReset();
    navigate.mockReset();
  });

  afterEach(cleanup);

  function renderWelcome() {
    render(
      <MemoryRouter>
        <WelcomeRoute />
      </MemoryRouter>,
    );
    return screen.getByRole('button', { name: 'Connect Gmail' });
  }

  it('opens Google consent and switches to the Gmail provider', async () => {
    const user = userEvent.setup();
    auth.googleClientId.mockReturnValue('client-123.apps.googleusercontent.com');
    auth.signIn.mockResolvedValue();

    await user.click(renderWelcome());

    await waitFor(() => expect(auth.signIn).toHaveBeenCalledOnce());
    expect(useMail.getState().provider.kind).toBe('gmail');
  });

  it('shows §3.1 2a when consent is denied, and stays on the demo provider', async () => {
    const user = userEvent.setup();
    auth.googleClientId.mockReturnValue('client-123.apps.googleusercontent.com');
    auth.signIn.mockRejectedValue(
      new AuthError(
        "Pigeon didn't get access to your mail. Google needs permission to read and send on your behalf for Pigeon to work. Try connecting again.",
        'denied',
      ),
    );

    await user.click(renderWelcome());

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /Pigeon didn't get access to your mail/,
    );
    expect(useMail.getState().provider.kind).toBe('mock');
    expect(navigate).not.toHaveBeenCalled();
  });

  it('shows §3.1 2b when Google grants only some of the scopes', async () => {
    const user = userEvent.setup();
    auth.googleClientId.mockReturnValue('client-123.apps.googleusercontent.com');
    auth.signIn.mockRejectedValue(
      new AuthError(
        'Pigeon needs all four permissions to sort your mail. Connect again and leave the checkboxes ticked.',
        'partial-scopes',
      ),
    );

    await user.click(renderWelcome());

    expect(await screen.findByRole('alert')).toHaveTextContent(/all four permissions/);
  });

  it('connects the demo account, and says so, when no client is configured', async () => {
    const user = userEvent.setup();
    auth.googleClientId.mockReturnValue(null);

    const button = renderWelcome();
    expect(screen.getByText(/No Google client is configured/)).toBeInTheDocument();

    await user.click(button);

    expect(auth.signIn).not.toHaveBeenCalled();
    expect(useMail.getState().provider.kind).toBe('mock');
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/setup/provider'));
  });

  it('hides the demo note once a client is configured', () => {
    auth.googleClientId.mockReturnValue('client-123.apps.googleusercontent.com');
    renderWelcome();
    expect(screen.queryByText(/No Google client is configured/)).not.toBeInTheDocument();
  });
});
