import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import App from '../../App';
import { useSettings } from '../../store/settings';
import { useMail } from '../../store/mail';
import { MockMailProvider } from '../../data/mock/mockProvider';

/**
 * §3.1 step 6 — "O1–O5 are never shown again for this account." Only /welcome
 * was gated, so the four /setup routes stayed reachable by URL and, more
 * realistically, by pressing Back from the inbox at the end of onboarding,
 * which walked a finished user straight into O5 again.
 *
 * `onboarded` is set once, at the end of O5, so gating these fences nobody out
 * of a flow they are still walking — the last case here is the one that proves
 * it.
 */
describe('onboarding is shown once (§3.1 step 6)', () => {
  beforeEach(() => {
    localStorage.clear();
    MockMailProvider.reset();
    useMail.getState().setProvider(new MockMailProvider());
  });

  afterEach(cleanup);

  function renderAt(path: string) {
    return render(
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>,
    );
  }

  const ONBOARDING = [
    '/welcome',
    '/setup/provider',
    '/setup/sync',
    '/setup/senders',
    '/setup/screener',
  ];

  for (const path of ONBOARDING) {
    it(`sends a finished account away from ${path}`, async () => {
      useSettings.setState({ onboarded: true });
      renderAt(path);

      await waitFor(() =>
        expect(screen.getByRole('heading', { level: 1, name: 'Inbox' })).toBeInTheDocument(),
      );
    });
  }

  /**
   * §8.5 item 1's harness links straight at O2–O5. Gating them sent every link
   * to /inbox, and the only way back in was to clear the flag from /welcome —
   * which navigates away from the harness. `reset=1` is the marker that page
   * already used; the gate honours it in dev builds.
   */
  it('lets the dev harness through with reset=1', async () => {
    useSettings.setState({ onboarded: true });
    renderAt('/setup/senders?reset=1');

    await waitFor(() =>
      expect(
        screen.getByRole('heading', { level: 1, name: 'Who already knows you?' }),
      ).toBeInTheDocument(),
    );
  });

  it('lets an account still onboarding reach the flow', async () => {
    useSettings.setState({ onboarded: false });
    renderAt('/setup/senders');

    await waitFor(() =>
      expect(
        screen.getByRole('heading', { level: 1, name: 'Who already knows you?' }),
      ).toBeInTheDocument(),
    );
  });
});
