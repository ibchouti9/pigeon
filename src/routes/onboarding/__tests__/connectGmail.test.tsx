import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { useMail } from '../../../store/mail';
import { MockMailProvider } from '../../../data/mock/mockProvider';
import { WelcomeRoute } from '../WelcomeRoute';

/**
 * O1 (§3.1, §5.1) — connecting is an email address and an app password,
 * verified end to end by a real IMAP LOGIN before onboarding moves an inch.
 * These mocks stand where Rust does; what is under test is the screen's side
 * of the bargain: the three shapes (form, already-connected, web build), the
 * §3.1 error branches, and the demo as an offer rather than a consolation.
 */

const connect = vi.hoisted(() => ({
  connectGmail: vi.fn<(email: string, password: string) => Promise<void>>(),
  mailConnected: vi.fn<() => boolean>(() => false),
  canConnectMail: vi.fn<() => boolean>(() => true),
}));

vi.mock('../../../data/imap/connect', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../data/imap/connect')>();
  return {
    ...actual,
    connectGmail: connect.connectGmail,
    mailConnected: connect.mailConnected,
    canConnectMail: connect.canConnectMail,
  };
});

const opened = vi.hoisted(() => ({ urls: [] as string[] }));
vi.mock('../../../lib/desktop', () => ({
  isDesktop: () => false,
  invoke: vi.fn(async () => ({})),
  openExternal: async (url: string) => {
    opened.urls.push(url);
  },
  onFileDrop: () => () => undefined,
}));

/** Stands where the real provider does; nothing here reaches a wire. */
vi.mock('../../../data/imap/imapProvider', () => ({
  ImapMailProvider: class {
    readonly kind = 'gmail';
    async getAccount() {
      return { email: 'me@gmail.com', name: 'me@gmail.com', connectedAt: '' };
    }
  },
}));

const navigate = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => navigate };
});

describe('O1 Connect Gmail (§3.1)', () => {
  beforeEach(() => {
    localStorage.clear();
    MockMailProvider.reset();
    useMail.getState().setProvider(new MockMailProvider());
    connect.connectGmail.mockReset();
    connect.mailConnected.mockReset();
    connect.mailConnected.mockReturnValue(false);
    connect.canConnectMail.mockReset();
    connect.canConnectMail.mockReturnValue(true);
    opened.urls.length = 0;
    navigate.mockReset();
  });

  afterEach(cleanup);

  function renderWelcome() {
    render(
      <MemoryRouter>
        <WelcomeRoute />
      </MemoryRouter>,
    );
  }

  async function fillAndConnect(user: ReturnType<typeof userEvent.setup>) {
    await user.type(screen.getByLabelText('Gmail address'), 'me@gmail.com');
    await user.type(screen.getByLabelText('App password'), 'abcdabcdabcdabcd');
    await user.click(screen.getByRole('button', { name: 'Connect Gmail' }));
  }

  it('verifies the pair, switches to the Gmail provider, and moves on', async () => {
    const user = userEvent.setup();
    connect.connectGmail.mockResolvedValue();
    renderWelcome();

    await fillAndConnect(user);

    await waitFor(() =>
      expect(connect.connectGmail).toHaveBeenCalledWith('me@gmail.com', 'abcdabcdabcdabcd'),
    );
    await waitFor(() => expect(useMail.getState().provider.kind).toBe('gmail'));
    expect(navigate).toHaveBeenCalledWith('/setup/provider');
  });

  it('shows the engine’s own words when Gmail refuses, and stays on the demo', async () => {
    const user = userEvent.setup();
    connect.connectGmail.mockRejectedValue(
      new Error(
        'That looks like your Google password. Pigeon needs an app password — 16 characters from myaccount.google.com/apppasswords.',
      ),
    );
    renderWelcome();

    await fillAndConnect(user);

    expect(await screen.findByRole('alert')).toHaveTextContent(/needs an app password/);
    expect(useMail.getState().provider.kind).toBe('mock');
    expect(navigate).not.toHaveBeenCalled();
  });

  it('opens the app-password page in the real browser', async () => {
    const user = userEvent.setup();
    renderWelcome();

    await user.click(screen.getByRole('button', { name: 'Get an app password' }));

    expect(opened.urls).toEqual(['https://myaccount.google.com/apppasswords']);
  });

  /**
   * A password already in the Keychain needs no second form-filling: the
   * screen offers one button and goes straight in, without re-verifying.
   */
  it('skips the form when a stored password survives', async () => {
    const user = userEvent.setup();
    connect.mailConnected.mockReturnValue(true);
    renderWelcome();

    expect(screen.queryByLabelText('App password')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Connect Gmail' }));

    await waitFor(() => expect(useMail.getState().provider.kind).toBe('gmail'));
    expect(connect.connectGmail).not.toHaveBeenCalled();
  });

  it('offers the demo as a choice, and never touches Gmail for it', async () => {
    const user = userEvent.setup();
    renderWelcome();

    await user.click(screen.getByRole('button', { name: 'Try the demo instead' }));

    expect(connect.connectGmail).not.toHaveBeenCalled();
    expect(useMail.getState().provider.kind).toBe('mock');
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/setup/provider'));
  });

  it('offers only the demo on the web build, and says why', () => {
    connect.canConnectMail.mockReturnValue(false);
    renderWelcome();

    expect(screen.queryByLabelText('Gmail address')).toBeNull();
    expect(screen.getByText(/web build/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try the demo instead' })).toBeInTheDocument();
  });

  it('hides the web-build note where real mail is reachable', () => {
    renderWelcome();
    expect(screen.queryByText(/web build/)).toBeNull();
  });
});
