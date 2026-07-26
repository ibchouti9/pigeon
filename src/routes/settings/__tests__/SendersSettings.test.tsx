import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { SendersSettings } from '../SendersSettings';
import { useMail } from '../../../store/mail';
import type { Sender } from '../../../types';

const APPROVED: Sender[] = [
  {
    id: 'a1',
    name: 'Dana Whitlock',
    email: 'dana@lumen.dev',
    status: 'approved',
    decidedAt: '2026-07-12T10:00:00.000Z',
  },
  {
    id: 'a2',
    name: 'Sana Sethi',
    email: 'sana@northbound.io',
    status: 'approved',
    decidedAt: '2026-07-24T10:00:00.000Z',
  },
];

const DECLINED: Sender[] = [
  {
    id: 'd1',
    name: 'Marketing Bot',
    email: 'marketing@northbound.io',
    status: 'declined',
    decidedAt: '2026-07-01T10:00:00.000Z',
  },
];

const originalReverse = useMail.getState().reverse;

function renderSenders() {
  return render(
    <MemoryRouter>
      <SendersSettings />
    </MemoryRouter>,
  );
}

describe('SendersSettings', () => {
  beforeEach(() => {
    useMail.setState((s) => ({
      approved: APPROVED,
      declined: DECLINED,
      status: { ...s.status, senders: 'ready' },
    }));
  });

  afterEach(() => {
    useMail.setState({ reverse: originalReverse });
  });

  it('filters the visible rows on name and address without changing the tab counts', async () => {
    renderSenders();

    expect(screen.getByRole('tab', { name: 'Approved (2)' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Declined (1)' })).toBeInTheDocument();
    expect(screen.getByText('Dana Whitlock')).toBeInTheDocument();
    expect(screen.getByText('Sana Sethi')).toBeInTheDocument();

    const filter = screen.getByRole('searchbox', { name: 'Filter senders' });
    await userEvent.type(filter, 'Dana');

    expect(screen.getByText('Dana Whitlock')).toBeInTheDocument();
    expect(screen.queryByText('Sana Sethi')).not.toBeInTheDocument();

    // §3.6 step 2 — the tab label counts never move when the filter runs.
    expect(screen.getByRole('tab', { name: 'Approved (2)' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Declined (1)' })).toBeInTheDocument();
  });

  it('calls reverse with the sender id and the opposite status on Decline', async () => {
    const reverse = vi.fn().mockResolvedValue(true);
    useMail.setState({ reverse });
    renderSenders();

    const row = screen.getByTestId('sender-row-a1');
    await userEvent.click(within(row).getByRole('button', { name: 'Decline' }));

    // §3.6 restamps the row and collapses it before the call goes out.
    await waitFor(() => expect(reverse).toHaveBeenCalledWith('a1', 'declined'));
  });

  it('calls reverse with the sender id and the opposite status on Approve', async () => {
    const reverse = vi.fn().mockResolvedValue(true);
    useMail.setState({ reverse });
    renderSenders();

    await userEvent.click(screen.getByRole('tab', { name: 'Declined (1)' }));

    const row = screen.getByTestId('sender-row-d1');
    await userEvent.click(within(row).getByRole('button', { name: 'Approve' }));

    await waitFor(() => expect(reverse).toHaveBeenCalledWith('d1', 'approved'));
  });
});
