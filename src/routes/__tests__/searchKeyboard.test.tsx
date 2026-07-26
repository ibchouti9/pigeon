import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { useMail } from '../../store/mail';
import { useUi } from '../../store/ui';
import { MockMailProvider } from '../../data/mock/mockProvider';
import { SearchRoute } from '../SearchRoute';

/**
 * §8.1 puts Search in the thread-list scope, and §5.11 says "↓ from the field
 * moves the cursor into results". Neither worked: `cursor` was `useState(0)`
 * with no setter and the route bound no keys for the list, so the rows' roving
 * tabindex pinned the only tab stop to result #1 and nothing moved off it.
 */
describe('search result keyboard navigation (§8.1)', () => {
  beforeEach(async () => {
    localStorage.clear();
    MockMailProvider.reset();
    useMail.getState().setProvider(new MockMailProvider());
    await useMail.getState().loadThreads('inbox');
    useUi.setState({ heldSheetSenderId: null, dialog: null, shortcutsOpen: false });
  });

  afterEach(cleanup);

  async function renderSearch(query: string) {
    render(
      <MemoryRouter initialEntries={[`/search?q=${encodeURIComponent(query)}`]}>
        <Routes>
          <Route path="/search" element={<SearchRoute />} />
          <Route path="/search/t/:threadId" element={<SearchRoute />} />
        </Routes>
      </MemoryRouter>,
    );
    // Search is debounced 250ms.
    await waitFor(() => expect(screen.getAllByRole('listitem').length).toBeGreaterThan(1), {
      timeout: 3000,
    });
    return screen.getAllByRole('listitem');
  }

  /**
   * §5.11's way in. The field holds focus on arrival, and §8.1 disables single
   * keys while focus is in a text field, so ↓ is the only key that crosses the
   * boundary — the list keys take over once a row has focus.
   */
  async function enterList(user: ReturnType<typeof userEvent.setup>) {
    await user.keyboard('{ArrowDown}');
    await waitFor(() => expect(cursorIndex()).toBe(0));
  }

  function cursorIndex(): number {
    const rows = Array.from(document.querySelectorAll('[data-search-row]'));
    return rows.findIndex((r) => (r as HTMLElement).tabIndex === 0);
  }

  it('moves the cursor down and up with j and k', async () => {
    const user = userEvent.setup();
    await renderSearch('the');

    await enterList(user);
    expect(cursorIndex()).toBe(0);
    await user.keyboard('j');
    expect(cursorIndex()).toBe(1);
    await user.keyboard('j');
    expect(cursorIndex()).toBe(2);
    await user.keyboard('k');
    expect(cursorIndex()).toBe(1);
  });

  it('stops at both ends rather than wrapping', async () => {
    const user = userEvent.setup();
    await renderSearch('the');

    await enterList(user);
    await user.keyboard('k');
    expect(cursorIndex()).toBe(0);

    await user.keyboard('{End}');
    const last = cursorIndex();
    await user.keyboard('j');
    expect(cursorIndex()).toBe(last);

    await user.keyboard('{Home}');
    expect(cursorIndex()).toBe(0);
  });

  it('gives the cursor row real focus, not just a tab stop', async () => {
    const user = userEvent.setup();
    await renderSearch('the');

    await enterList(user);
    await user.keyboard('j');
    const focused = document.activeElement as HTMLElement;
    expect(focused.dataset.searchRow).toBe('1');
  });

  it('opens the cursor row on Enter', async () => {
    const user = userEvent.setup();
    await renderSearch('the');

    await enterList(user);
    await user.keyboard('j');

    const opened = document.querySelector<HTMLElement>('[data-search-row="1"]');
    const subject = opened?.textContent ?? '';
    await user.keyboard('{Enter}');

    // The reader mounts alongside the list, headed by the thread's subject.
    await waitFor(() => {
      const heading = screen.getByRole('heading', { level: 1 });
      expect(subject).toContain(heading.textContent ?? '');
    });
  });

  it('archives the cursor row on e', async () => {
    const user = userEvent.setup();
    await renderSearch('the');

    await enterList(user);
    const archived = useMail.getState().archive.length;
    await user.keyboard('e');

    await waitFor(() => expect(useMail.getState().archive.length).toBe(archived + 1));
  });

  /**
   * §8.1 — "`e` archives the cursor row (Inbox) / moves to inbox (Archive)".
   * Search groups its results by place and every row carries its own, but `e`
   * sent them all to the archive, so an ARCHIVE result was re-archived where it
   * should have come back.
   */
  it('sends an archived result back to the inbox on e', async () => {
    const user = userEvent.setup();
    await useMail.getState().loadThreads('archive');
    await renderSearch('the');

    const rows = Array.from(document.querySelectorAll<HTMLElement>('[data-search-row]'));
    const subjects = useMail.getState().archive.map((t) => t.subject);
    const index = rows.findIndex((r) => subjects.some((s) => r.textContent?.includes(s)));
    expect(index, 'the query needs at least one archived result').toBeGreaterThan(-1);

    await enterList(user);
    await user.keyboard('{Home}');
    for (let i = 0; i < index; i++) await user.keyboard('j');
    expect(cursorIndex()).toBe(index);

    const inboxBefore = useMail.getState().inbox.length;
    await user.keyboard('e');

    await waitFor(() => expect(useMail.getState().inbox.length).toBe(inboxBefore + 1));
  });

  /**
   * §5.6 — "read one conversation and act on it without leaving the pane". The
   * Search reader rendered Reply, Reply all and Forward, plus the "Reply to
   * {name}" affordance and `r`/`a`/`f`, with nothing behind any of them: every
   * one silently did nothing.
   */
  describe('replying to a result', () => {
    async function openFirstResult(user: ReturnType<typeof userEvent.setup>) {
      await renderSearch('the');
      const rows = Array.from(document.querySelectorAll<HTMLElement>('[data-search-row]'));
      await user.click(rows[0]);
      await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument());
    }

    it('opens a composer from the Reply button', async () => {
      const user = userEvent.setup();
      await openFirstResult(user);

      await user.click(screen.getByRole('button', { name: 'Reply' }));

      await waitFor(() => expect(screen.getByLabelText('Message body')).toBeInTheDocument());
    });

    it('opens one from r, as §8.1 says', async () => {
      const user = userEvent.setup();
      await openFirstResult(user);

      await user.keyboard('r');

      await waitFor(() => expect(screen.getByLabelText('Message body')).toBeInTheDocument());
    });

    it('forwards from f', async () => {
      const user = userEvent.setup();
      await openFirstResult(user);

      await user.keyboard('f');

      // Forward starts with no recipient, which is what distinguishes it here.
      await waitFor(() => expect(screen.getByLabelText('Message body')).toBeInTheDocument());
      expect(screen.getByRole('button', { name: /Send/ })).toBeDisabled();
    });

    it('closes the result on u', async () => {
      const user = userEvent.setup();
      await openFirstResult(user);

      await user.keyboard('u');

      await waitFor(() =>
        expect(screen.queryByRole('heading', { level: 1 })).not.toBeInTheDocument(),
      );
    });
  });

  /**
   * Until /archive has been visited the store holds only the inbox, so an
   * archived result exists nowhere but the results themselves. Deriving the
   * open thread from those alone meant clearing the query emptied the reader
   * mid-read — and once Search gained a composer, that took an open reply and
   * everything typed into it, with no warning and no undo.
   */
  it('keeps an archived result open when the query is cleared', async () => {
    const user = userEvent.setup();
    // The store deliberately holds no archive: that is the state this breaks in.
    expect(useMail.getState().archive).toEqual([]);
    await renderSearch('the');

    const archivedIds = new Set(
      (await useMail.getState().provider.listThreads('archive')).map((t) => t.id),
    );
    const rows = Array.from(document.querySelectorAll<HTMLElement>('[data-search-row]'));
    const subjects = new Map(
      (await useMail.getState().provider.listThreads('archive')).map((t) => [t.subject, t.id]),
    );
    const row = rows.find((r) =>
      [...subjects.keys()].some((subject) => r.textContent?.includes(subject)),
    );
    expect(row, 'the query needs at least one archived result').toBeTruthy();
    expect(archivedIds.size).toBeGreaterThan(0);

    await user.click(row!);
    await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument());
    const subject = screen.getByRole('heading', { level: 1 }).textContent;

    await user.keyboard('r');
    const body = await screen.findByLabelText('Message body');
    await user.type(body, 'Words I would hate to lose.');

    await user.clear(screen.getByRole('searchbox', { name: 'Search mail' }));

    await waitFor(() => expect(screen.queryAllByRole('listitem')).toHaveLength(0));
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(subject);
    expect(screen.getByLabelText('Message body')).toHaveValue('Words I would hate to lose.');
  });

  /**
   * The thread keys act on what is being read, and the reader outlives the
   * results — so an emptiness guard meant for the list left `r`/`a`/`f`/`u`
   * dead on a reader that was still on screen with working buttons.
   */
  it('still replies and closes with no results left', async () => {
    const user = userEvent.setup();
    await renderSearch('the');

    const rows = Array.from(document.querySelectorAll<HTMLElement>('[data-search-row]'));
    await user.click(rows[0]);
    await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument());

    await user.clear(screen.getByRole('searchbox', { name: 'Search mail' }));
    await waitFor(() => expect(screen.queryAllByRole('listitem')).toHaveLength(0));

    // §8.1 disables single keys inside a text field, so leave the query bar.
    act(() => (document.activeElement as HTMLElement)?.blur());
    await user.keyboard('r');
    expect(await screen.findByLabelText('Message body')).toBeInTheDocument();

    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByLabelText('Message body')).not.toBeInTheDocument());

    await user.keyboard('u');
    await waitFor(() =>
      expect(screen.queryByRole('heading', { level: 1 })).not.toBeInTheDocument(),
    );
  });

  /**
   * A new result set resets the cursor to 0 while the reader keeps showing what
   * it was showing, so `e` archived a thread the user had never looked at.
   */
  it('archives the thread being read, not whatever the cursor reset to', async () => {
    const user = userEvent.setup();
    await renderSearch('the');

    const rows = Array.from(document.querySelectorAll<HTMLElement>('[data-search-row]'));
    await user.click(rows[2]);
    await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument());
    const openSubject = screen.getByRole('heading', { level: 1 }).textContent;

    // A different query resets the cursor to 0; the reader stays put.
    await user.clear(screen.getByRole('searchbox', { name: 'Search mail' }));
    await user.type(screen.getByRole('searchbox', { name: 'Search mail' }), 'the');
    await waitFor(() => expect(cursorIndex()).toBe(0));

    act(() => (document.activeElement as HTMLElement)?.blur());
    await user.keyboard('e');

    await waitFor(() =>
      expect(useMail.getState().archive.some((t) => t.subject === openSubject)).toBe(true),
    );
  });

  /**
   * Clicking left the cursor where it was, so `e` acted on a thread that was
   * not the one on screen, and j/k jumped back somewhere else.
   */
  it('moves the cursor to a row that is opened by clicking', async () => {
    const user = userEvent.setup();
    await renderSearch('the');

    const rows = Array.from(document.querySelectorAll<HTMLElement>('[data-search-row]'));
    expect(rows.length).toBeGreaterThan(2);

    await user.click(rows[2]);

    await waitFor(() => expect(cursorIndex()).toBe(2));
  });
});
