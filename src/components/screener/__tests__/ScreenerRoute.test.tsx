import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { useMail } from '../../../store/mail';
import { useUi } from '../../../store/ui';
import { ScreenerRoute } from '../../../routes/ScreenerRoute';
import { makeHeldList } from './fixtures';

function renderScreener(path = '/screener') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/screener" element={<ScreenerRoute />} />
        <Route path="/screener/s/:senderId" element={<ScreenerRoute />} />
      </Routes>
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
  useUi.setState({ heldSheetSenderId: null, dialog: null, shortcutsOpen: false });
});

describe('ScreenerRoute — states', () => {
  it('shows the "Nothing waiting." empty state when the held list is empty (§5.7)', () => {
    useMail.setState((s) => ({
      held: [],
      status: { ...s.status, held: 'ready' },
      loadHeld: vi.fn(),
    }));

    renderScreener();

    expect(screen.getByText('Nothing waiting.')).toBeInTheDocument();
    expect(
      screen.getByText(
        "New senders will appear here. You'll never miss them — they just don't interrupt you.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: "See who you've approved" })).toBeInTheDocument();
    // The digest block is hidden entirely when empty (§5.7).
    expect(screen.queryByRole('group', { name: 'Filter by category' })).not.toBeInTheDocument();
  });

  it('shows the Gmail-unreachable error state when the held list failed to load', () => {
    useMail.setState((s) => ({
      held: [],
      status: { ...s.status, held: 'error' },
      loadHeld: vi.fn(),
    }));

    renderScreener();

    expect(screen.getByText("Pigeon can't reach Gmail.")).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('renders the Screener header with the Stack / Bulk review toggle when senders are held', () => {
    useMail.setState((s) => ({
      held: makeHeldList(['s0', 's1']),
      status: { ...s.status, held: 'ready' },
      loadHeld: vi.fn(),
      decide: vi.fn().mockResolvedValue(true),
    }));

    renderScreener();

    expect(screen.getByRole('heading', { name: 'Screener', level: 1 })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Stack' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Bulk review' })).toBeInTheDocument();
    // The stack renders behind the digest with the first held sender on top.
    expect(screen.getByRole('heading', { name: 'Sender s0', level: 2 })).toBeInTheDocument();
  });
});
