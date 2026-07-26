import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { useMail } from '../../../store/mail';
import { MockMailProvider } from '../../../data/mock/mockProvider';
import { MailPlaceScreen } from '../MailPlaceScreen';

/**
 * The shell loads the inbox at mount because the rail's unread count needs it
 * on every route. Nothing loaded the other places, so the Archive sat on its
 * loading state forever — the whole screen was dead and neither typecheck nor
 * lint could see it.
 */
describe('a mail place loads its own threads', () => {
  beforeEach(() => {
    localStorage.clear();
    MockMailProvider.reset();
    useMail.getState().setProvider(new MockMailProvider());
  });

  function renderPlace(place: 'inbox' | 'archive') {
    return render(
      <MemoryRouter initialEntries={[`/${place}`]}>
        <Routes>
          <Route path={`/${place}`} element={<MailPlaceScreen place={place} />} />
        </Routes>
      </MemoryRouter>,
    );
  }

  it('fetches the archive when the Archive screen opens', async () => {
    expect(useMail.getState().status.archive).toBe('idle');

    renderPlace('archive');

    await waitFor(() => expect(useMail.getState().status.archive).toBe('ready'));
    expect(useMail.getState().archive.length).toBeGreaterThan(0);
  });

  it('leaves the loading state once the archive arrives', async () => {
    renderPlace('archive');
    await waitFor(() => {
      expect(screen.queryByText(/Loading archive/i)).not.toBeInTheDocument();
    });
  });
});
