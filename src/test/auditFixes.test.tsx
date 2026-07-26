import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { useMail } from '../store/mail';
import { useUi } from '../store/ui';
import { useToasts } from '../store/toast';
import { MockMailProvider } from '../data/mock/mockProvider';
import { SearchRoute } from '../routes/SearchRoute';
import { AppShell } from '../components/shell/AppShell';
import { MailListColumn } from '../components/mail/MailListColumn';
import { ThreadReader } from '../components/mail/ThreadReader';

function resetStores() {
  localStorage.clear();
  MockMailProvider.reset();
  useMail.getState().setProvider(new MockMailProvider());
  useToasts.setState({ toasts: [] });
  useUi.setState({ heldSheetSenderId: null, dialog: null, shortcutsOpen: false });
}

/**
 * §5.11 — "clicking one opens the held-message sheet over the results". The
 * sheet was mounted by the Screener alone, so on /search the click set
 * `heldSheetSenderId` and rendered nothing. Because an open sheet blocks every
 * single-key shortcut, the whole app's keyboard went dead until the user
 * pressed Esc on a sheet they could not see.
 */
describe('the held-message sheet is a global layer (§5.11)', () => {
  beforeEach(resetStores);
  afterEach(cleanup);

  it('renders wherever it is opened from, not only on the Screener', async () => {
    render(
      <MemoryRouter initialEntries={['/inbox']}>
        <Routes>
          <Route element={<AppShell />}>
            <Route path="/inbox" element={<div>inbox</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => expect(useMail.getState().held.length).toBeGreaterThan(0));
    const sender = useMail.getState().held[0].sender.id;

    useUi.getState().openHeldSheet(sender);

    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());
  });

  it('opens from a held search result', async () => {
    const user = userEvent.setup();
    await useMail.getState().loadHeld();

    render(
      <MemoryRouter initialEntries={['/search?q=atlas&held=1']}>
        <Routes>
          <Route element={<AppShell />}>
            <Route path="/search" element={<SearchRoute />} />
            <Route path="/search/t/:threadId" element={<SearchRoute />} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    // The HELD group's rows are sender rows; the thread rows above them can
    // match the same name, so scope to the group.
    await waitFor(() => expect(screen.getByText('HELD')).toBeInTheDocument(), { timeout: 3000 });
    const heldRows = [...document.querySelectorAll('[data-held-row]')];
    expect(heldRows.length).toBeGreaterThan(0);
    await user.click(heldRows[0] as HTMLElement);

    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());
  });
});

/**
 * §5.11 — "matched terms in the subject and snippet are wrapped in a mark".
 * Only the held sender rows had it; the thread rows, which are most of any
 * result set, showed nothing marked at all.
 */
describe('search marks the matched terms (§5.11)', () => {
  beforeEach(resetStores);
  afterEach(cleanup);

  it('marks the query in a result subject', async () => {
    await useMail.getState().loadThreads('inbox');
    render(
      <MemoryRouter initialEntries={['/search?q=window']}>
        <Routes>
          <Route path="/search" element={<SearchRoute />} />
          <Route path="/search/t/:threadId" element={<SearchRoute />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => expect(document.querySelectorAll('[data-search-row]').length).toBeGreaterThan(0), {
      timeout: 3000,
    });

    const marks = [...document.querySelectorAll('[data-search-row] mark')];
    expect(marks.length).toBeGreaterThan(0);
    expect(marks.every((m) => m.textContent?.toLowerCase() === 'window')).toBe(true);
  });
});

/** §7.4's row is written at 7 senders; at one it read "1 sender are waiting". */
describe('the cleared-inbox empty state agrees with itself', () => {
  beforeEach(resetStores);
  afterEach(cleanup);

  function renderEmpty(heldCount: number) {
    render(
      <MemoryRouter>
        <MailListColumn
          title="Inbox"
          place="inbox"
          threads={[]}
          status="ready"
          online
          revoked={false}
          heldCount={heldCount}
          // "Cleared", not "day one" — the row §7.4 writes at 7 senders.
          hasArchivedAny
          onOpenThread={vi.fn()}
          onArchiveThread={vi.fn()}
          onArchiveMany={vi.fn()}
          onOpenScreener={vi.fn()}
          onSendTest={vi.fn()}
          onRetry={vi.fn()}
          onConnectGmail={vi.fn()}
        />
      </MemoryRouter>,
    );
  }

  it('says "1 sender is waiting"', () => {
    renderEmpty(1);
    expect(screen.getByText(/1 sender is waiting in the Screener\./)).toBeInTheDocument();
  });

  it('says "7 senders are waiting"', () => {
    renderEmpty(7);
    expect(screen.getByText(/7 senders are waiting in the Screener\./)).toBeInTheDocument();
  });
});

/**
 * C-10 — "Hide" means the block is gone for the session. Hiding a long thread's
 * summary made the header offer to regenerate the thing just dismissed.
 */
describe('hiding a summary hides the offer to make one (C-10)', () => {
  beforeEach(resetStores);
  afterEach(cleanup);

  it('drops the Summarize button once the block is hidden', async () => {
    const user = userEvent.setup();
    await useMail.getState().loadThreads('inbox');
    const thread = useMail.getState().inbox.find((t) => t.messages.length >= 2)!;

    render(
      <MemoryRouter>
        <ThreadReader
          thread={thread}
          status="ready"
          place="inbox"
          selfEmail="marc@ferrum.dev"
          breakpoint="desktop"
          online
          summary={['One thing.', 'Another thing.']}
          summaryState="ready"
          hasProvider
          onSummarize={vi.fn()}
        />
      </MemoryRouter>,
    );

    await user.click(screen.getByRole('button', { name: 'Hide' }));

    expect(screen.queryByRole('button', { name: 'Summarize thread' })).not.toBeInTheDocument();
  });
});
