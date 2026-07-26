import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { useMail } from '../../../store/mail';
import { MockMailProvider } from '../../../data/mock/mockProvider';
import { AuthError, type GmailStatus } from '../../../data/gmail/auth';
import { WelcomeRoute } from '../WelcomeRoute';

const auth = vi.hoisted(() => ({
  signIn: vi.fn<() => Promise<void>>(),
  gmailStatus: vi.fn<() => GmailStatus>(),
}));

vi.mock('../../../data/gmail/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../data/gmail/auth')>();
  return { ...actual, signIn: auth.signIn, gmailStatus: auth.gmailStatus };
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
 *
 * The screen now has three shapes, one per thing this build can reach, and the
 * cases below are one per shape plus the two consent failures.
 */
describe('O1 Connect Gmail (§3.1)', () => {
  /** The macOS app, with the one-time Google setup already done. */
  const READY: GmailStatus = { canConnect: true, canSetUp: true, hasSession: false };
  /** The macOS app on first run: real mail is reachable, after five minutes. */
  const NEEDS_SETUP: GmailStatus = { canConnect: false, canSetUp: true, hasSession: false };
  /** The web build, which has no client baked in: demo or nothing. */
  const DEMO_ONLY: GmailStatus = { canConnect: false, canSetUp: false, hasSession: false };

  beforeEach(() => {
    localStorage.clear();
    MockMailProvider.reset();
    useMail.getState().setProvider(new MockMailProvider());
    auth.signIn.mockReset();
    auth.gmailStatus.mockReset();
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
    auth.gmailStatus.mockReturnValue(READY);
    auth.signIn.mockResolvedValue();

    await user.click(renderWelcome());

    await waitFor(() => expect(auth.signIn).toHaveBeenCalledOnce());
    expect(useMail.getState().provider.kind).toBe('gmail');
  });

  /**
   * A grant already in the Keychain is the whole point of the desktop flow: it
   * survives a restart. Sending the user back through Google's consent screen
   * when Pigeon can already reach their mail is a round trip for nothing.
   */
  it('skips consent when a stored grant survives', async () => {
    const user = userEvent.setup();
    auth.gmailStatus.mockReturnValue({ ...READY, hasSession: true });

    await user.click(renderWelcome());

    await waitFor(() => expect(useMail.getState().provider.kind).toBe('gmail'));
    expect(auth.signIn).not.toHaveBeenCalled();
  });

  it('shows §3.1 2a when consent is denied, and stays on the demo provider', async () => {
    const user = userEvent.setup();
    auth.gmailStatus.mockReturnValue(READY);
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
    auth.gmailStatus.mockReturnValue(READY);
    auth.signIn.mockRejectedValue(
      new AuthError(
        'Pigeon needs all four permissions to sort your mail. Connect again and leave the checkboxes ticked.',
        'partial-scopes',
      ),
    );

    await user.click(renderWelcome());

    expect(await screen.findByRole('alert')).toHaveTextContent(/all four permissions/);
  });

  /**
   * The first run of the macOS app. Connect Gmail must not fail with "no client
   * configured" — that was the old dead end, and it sent the user to a README.
   * It opens the setup instead, and does not touch Google on the way.
   */
  it('opens the one-time setup when the app has no Google client yet', async () => {
    const user = userEvent.setup();
    auth.gmailStatus.mockReturnValue(NEEDS_SETUP);

    await user.click(renderWelcome());

    expect(await screen.findByText(/Turn on the Gmail API/)).toBeInTheDocument();
    expect(auth.signIn).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('connects the demo account, and says so, when the build has no client', async () => {
    const user = userEvent.setup();
    auth.gmailStatus.mockReturnValue(DEMO_ONLY);

    const button = renderWelcome();
    expect(screen.getByText(/This is the web build/)).toBeInTheDocument();

    await user.click(button);

    expect(auth.signIn).not.toHaveBeenCalled();
    expect(useMail.getState().provider.kind).toBe('mock');
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/setup/provider'));
  });

  it('hides the web-build note once real mail is reachable', () => {
    auth.gmailStatus.mockReturnValue(READY);
    renderWelcome();
    expect(screen.queryByText(/This is the web build/)).not.toBeInTheDocument();
  });

  /**
   * The demo is the only path that works in the ten seconds after a download,
   * so it is an offer on its own rather than something you reach by failing.
   */
  it('offers the demo as a choice, whatever else is reachable', async () => {
    const user = userEvent.setup();
    auth.gmailStatus.mockReturnValue(READY);
    renderWelcome();

    await user.click(screen.getByRole('button', { name: 'Try the demo instead' }));

    expect(auth.signIn).not.toHaveBeenCalled();
    expect(useMail.getState().provider.kind).toBe('mock');
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/setup/provider'));
  });
});
