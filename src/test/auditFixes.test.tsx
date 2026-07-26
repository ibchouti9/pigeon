import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
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
import { ComposeDock } from '../components/compose/ComposeDock';
import { useCompose } from '../store/compose';
import { SendersSettings } from '../routes/settings/SendersSettings';

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

/**
 * §5.5 — a revoked token "locks the whole shell: the list and reader both show
 * it, and only Settings and this action remain interactive". Only the list
 * column rendered it, so the reader sat beside the error saying "Select a
 * thread to read it." and every route stayed live.
 */
describe('a revoked token locks the shell (§5.5)', () => {
  beforeEach(resetStores);
  afterEach(cleanup);

  function renderShell(entry: string) {
    render(
      <MemoryRouter initialEntries={[entry]}>
        <Routes>
          <Route element={<AppShell />}>
            <Route path="/inbox" element={<div>inbox contents</div>} />
            <Route path="/settings/account" element={<div>account settings</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );
  }

  it('replaces the whole region, not just the list', async () => {
    useMail.setState({ revoked: true });
    renderShell('/inbox');

    expect(await screen.findByText('Pigeon lost access to your mail.')).toBeInTheDocument();
    expect(screen.queryByText('inbox contents')).not.toBeInTheDocument();
  });

  it('locks the mail destinations and Compose', async () => {
    useMail.setState({ revoked: true });
    renderShell('/inbox');
    await screen.findByText('Pigeon lost access to your mail.');

    for (const label of ['Inbox', 'Screener', 'Archive']) {
      expect(screen.getByRole('link', { name: new RegExp(`^${label}`) })).toHaveAttribute(
        'aria-disabled',
        'true',
      );
    }
    expect(screen.getByRole('button', { name: 'Compose' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
  });

  it('leaves Settings reachable and readable', async () => {
    useMail.setState({ revoked: true });
    renderShell('/settings/account');

    expect(await screen.findByText('account settings')).toBeInTheDocument();
    expect(screen.queryByText('Pigeon lost access to your mail.')).not.toBeInTheDocument();
  });

  it('gets out of the way once the token is good again', async () => {
    useMail.setState({ revoked: false });
    renderShell('/inbox');

    expect(await screen.findByText('inbox contents')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /^Inbox/ })).not.toHaveAttribute('aria-disabled');
  });
});

/**
 * §5.12 — "below 880px the dock becomes a full-screen sheet with the same
 * internals and a 'Cancel'/'Send' header". Only the CSS changed: the header
 * stayed the dock's truncated subject plus expand and minimize, neither of
 * which means anything on a sheet that already fills the screen.
 */
describe('the compose sheet below 880px (§5.12)', () => {
  beforeEach(resetStores);
  afterEach(() => {
    cleanup();
    useCompose.getState().close();
    setWidth(1280);
  });

  function setWidth(width: number) {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
    window.dispatchEvent(new Event('resize'));
  }

  function renderDock() {
    render(
      <MemoryRouter>
        <ComposeDock />
      </MemoryRouter>,
    );
  }

  it('shows Cancel and Send instead of the dock chrome', async () => {
    setWidth(800);
    useCompose.getState().open();
    renderDock();

    await waitFor(() => expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Expand' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Minimize' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Close' })).not.toBeInTheDocument();
  });

  it('keeps the dock chrome above 880px', async () => {
    setWidth(1280);
    useCompose.getState().open();
    renderDock();

    await waitFor(() => expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument();
  });
});

/**
 * §3.6 step 3 — "the row's postmark restamps to 'DECLINED · JUL 25' and the row
 * animates out of the Approved list (180ms collapse)", and 3b returns a failed
 * row "with a destructive 1px outline for 3s". The row was simply moved between
 * lists with no stamp, no animation and no outline.
 */
describe('reversing a decision in Settings (§3.6)', () => {
  beforeEach(resetStores);
  afterEach(cleanup);

  async function renderSenders() {
    render(
      <MemoryRouter>
        <SendersSettings />
      </MemoryRouter>,
    );
    await waitFor(() => expect(document.querySelectorAll('[data-sender-row]').length).toBeGreaterThan(0), {
      timeout: 3000,
    });
  }

  it('restamps the row and collapses it before the call goes out', async () => {
    const user = userEvent.setup();
    const reverse = vi.fn<(id: string, to: 'approved' | 'declined') => Promise<boolean>>(
      () => new Promise(() => {}),
    );
    useMail.setState({ reverse });
    await renderSenders();

    const row = document.querySelector<HTMLElement>('[data-sender-row="0"]')!;
    await user.click(within(row).getByRole('button', { name: 'Decline' }));

    // The stamp flips first, and the row is on its way out — all before the
    // store is asked to do anything.
    expect(row.className).toMatch(/_leaving_/);
    expect(row.textContent).toMatch(/DECLINED/i);
    expect(reverse).not.toHaveBeenCalled();

    await waitFor(() => expect(reverse).toHaveBeenCalled());
  });

  it('outlines the row when the reversal fails (§3.6 3b)', async () => {
    const user = userEvent.setup();
    useMail.setState({ reverse: vi.fn().mockResolvedValue(false) });
    await renderSenders();

    const row = document.querySelector<HTMLElement>('[data-sender-row="0"]')!;
    await user.click(within(row).getByRole('button', { name: 'Decline' }));

    await waitFor(() => {
      expect(document.querySelector('[data-sender-row="0"]')?.className).toMatch(/_failed_/);
    });
  });
});
