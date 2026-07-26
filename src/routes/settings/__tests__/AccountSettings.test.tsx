import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AccountSettings } from '../AccountSettings';
import { ConfirmDialog } from '../../../components/settings/ConfirmDialog';
import { useMail } from '../../../store/mail';
import { useUi } from '../../../store/ui';

function renderAccount() {
  return render(
    <MemoryRouter>
      <AccountSettings />
      <ConfirmDialog />
    </MemoryRouter>,
  );
}

describe('AccountSettings dialogs (§7.7)', () => {
  beforeEach(() => {
    useMail.setState({
      account: {
        email: 'marc@ferrum.dev',
        name: 'Marc Ferrum',
        connectedAt: '2026-07-01T00:00:00.000Z',
      },
    });
    useUi.setState({ dialog: null });
  });

  it('renders the disconnect dialog copy word for word', async () => {
    renderAccount();

    await userEvent.click(screen.getByRole('button', { name: 'Disconnect Google account' }));

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Disconnect marc@ferrum.dev?')).toBeInTheDocument();
    expect(
      within(dialog).getByText(
        "Pigeon will stop syncing and you'll be signed out. Your mail stays in Gmail, and your approved and declined senders are kept for 30 days.",
      ),
    ).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Disconnect account' })).toBeInTheDocument();
  });

  it('renders the sign-out dialog copy word for word', async () => {
    renderAccount();

    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Sign out of Pigeon?')).toBeInTheDocument();
    expect(
      within(dialog).getByText("You'll need to sign in with Google again. Nothing changes in your mail."),
    ).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    // Two "Sign out" buttons now exist (the trigger, behind the scrim, and the dialog's own) —
    // scope to the dialog to find the confirm action specifically.
    expect(within(dialog).getByRole('button', { name: 'Sign out' })).toBeInTheDocument();
  });
});
