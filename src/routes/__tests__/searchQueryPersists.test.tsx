import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { useMail } from '../../store/mail';
import { useUi } from '../../store/ui';
import { MockMailProvider } from '../../data/mock/mockProvider';
import { SearchRoute } from '../SearchRoute';

/**
 * §5.11 draws the reader beside the results — "reader (a result is open)" with
 * the result list still in its column. Opening one navigated to
 * `/search/t/:id` and dropped the query string with it, so the query cleared,
 * the results vanished, and the screen showed the recent-searches list next to
 * an open thread. Every way of opening a result did it, and so did going back.
 */
describe('opening a result keeps the search (§5.11)', () => {
  beforeEach(async () => {
    localStorage.clear();
    MockMailProvider.reset();
    useMail.getState().setProvider(new MockMailProvider());
    await useMail.getState().loadThreads('inbox');
    useUi.setState({ heldSheetSenderId: null, dialog: null, shortcutsOpen: false });
  });

  afterEach(cleanup);

  function renderSearch(entry: string) {
    const seen: string[] = [];
    function Spy() {
      seen.push(location.pathname + location.search);
      return null;
    }
    render(
      <MemoryRouter initialEntries={[entry]}>
        <Routes>
          <Route path="/search" element={<SearchRoute />} />
          <Route path="/search/t/:threadId" element={<SearchRoute />} />
        </Routes>
        <Spy />
      </MemoryRouter>,
    );
    return seen;
  }

  async function results() {
    await waitFor(() => expect(document.querySelectorAll('[data-search-row]').length).toBeGreaterThan(0), {
      timeout: 3000,
    });
    return document.querySelectorAll('[data-search-row]').length;
  }

  it('keeps the results listed after a click opens one', async () => {
    const user = userEvent.setup();
    renderSearch('/search?q=window');
    const before = await results();

    await user.click(document.querySelector<HTMLElement>('[data-search-row="0"]')!);

    // The reader mounts, and the list it came from is still there.
    await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument());
    expect(document.querySelectorAll('[data-search-row]')).toHaveLength(before);
  });

  it('keeps the query in the field after opening a result', async () => {
    const user = userEvent.setup();
    renderSearch('/search?q=window');
    await results();

    await user.click(document.querySelector<HTMLElement>('[data-search-row="0"]')!);

    await waitFor(() => expect(screen.getByRole('searchbox')).toHaveValue('window'));
  });

  it('keeps the results when Enter opens one from the keyboard', async () => {
    const user = userEvent.setup();
    renderSearch('/search?q=window');
    const before = await results();

    await user.keyboard('{ArrowDown}');
    await user.keyboard('{Enter}');

    await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument());
    expect(document.querySelectorAll('[data-search-row]')).toHaveLength(before);
  });

  it('keeps the held toggle across an open', async () => {
    const user = userEvent.setup();
    renderSearch('/search?q=window&held=1');
    await results();

    const toggle = screen.getByRole('checkbox', { name: /Also search held mail/ });
    expect(toggle).toBeChecked();

    await user.click(document.querySelector<HTMLElement>('[data-search-row="0"]')!);
    await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument());
    expect(screen.getByRole('checkbox', { name: /Also search held mail/ })).toBeChecked();
  });
});
