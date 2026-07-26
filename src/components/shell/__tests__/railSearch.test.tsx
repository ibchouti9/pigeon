import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { NavRail } from '../NavRail';

/**
 * §2.2 spells the search URL `/search?q=…&held=0|1`, and the rail's field was
 * neither reading it nor preserving it. Landing on one — a reload, a bookmark,
 * the back button — left the field empty beside a full page of results. And
 * because every keystroke navigates, typing a character replaced the query
 * instead of editing it, and dropped `held` with it: the "Also search held
 * mail" scope silently turned itself off, changing which results were shown.
 */

function Url() {
  const { pathname, search } = useLocation();
  return <output data-testid="url">{pathname + search}</output>;
}

function renderRail(at: string) {
  return render(
    <MemoryRouter initialEntries={[at]}>
      <NavRail compact={false} />
      <Url />
      <Routes>
        <Route path="*" element={null} />
      </Routes>
    </MemoryRouter>,
  );
}

const field = () => screen.getByRole('searchbox', { name: 'Search mail' });

describe('the rail’s search field', () => {
  it('shows the query the URL is already carrying', () => {
    renderRail('/search?q=atlas');
    expect(field()).toHaveValue('atlas');
  });

  it('is empty anywhere else, so the Inbox does not look like a search', () => {
    // With a stray `q` too: the field mirrors whether the user is searching,
    // not whatever the URL happens to carry.
    renderRail('/inbox?q=atlas');
    expect(field()).toHaveValue('');
  });

  it('edits the query rather than replacing it', async () => {
    const user = userEvent.setup();
    renderRail('/search?q=atlas');

    await user.type(field(), 'x');

    expect(screen.getByTestId('url')).toHaveTextContent('q=atlasx');
  });

  it('keeps §2.2’s held parameter when the query changes', async () => {
    const user = userEvent.setup();
    renderRail('/search?q=atlas&held=1');

    await user.type(field(), 'x');

    // Editing the words must not quietly change which mail is being searched.
    expect(screen.getByTestId('url')).toHaveTextContent('held=1');
  });

  it('keeps the query while a result is open', async () => {
    // Opening a result routes to /search/t/:id and carries the query along;
    // the user has not left their search.
    renderRail('/search/t/t1?q=atlas&held=1');
    expect(field()).toHaveValue('atlas');
  });

  it('starts a search from anywhere', async () => {
    const user = userEvent.setup();
    renderRail('/inbox');

    await user.type(field(), 'dana');

    expect(screen.getByTestId('url')).toHaveTextContent('/search?q=dana');
  });

  it('goes back to an empty search when the query is cleared', async () => {
    const user = userEvent.setup();
    renderRail('/search?q=a&held=1');

    await user.clear(field());

    // §5.11's empty-query state, not a search for nothing.
    expect(screen.getByTestId('url')).toHaveTextContent('/search');
    expect(screen.getByTestId('url')).not.toHaveTextContent('q=');
  });
});
