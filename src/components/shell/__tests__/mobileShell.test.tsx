import { beforeEach, describe, expect, it } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { MobileShell } from '../MobileShell';
import { AppShell } from '../AppShell';
import { useMail } from '../../../store/mail';
import { useCompose } from '../../../store/compose';
import { useUi } from '../../../store/ui';
import { MockMailProvider } from '../../../data/mock/mockProvider';
import { setViewportWidth } from '../../../test/setup';

/**
 * The phone shell, and the two things about it that are easy to get wrong by
 * accident: which destinations it offers, and whether the overlays every other
 * screen depends on are mounted underneath it.
 */
describe('MobileShell', () => {
  beforeEach(() => {
    localStorage.clear();
    MockMailProvider.reset();
    useMail.getState().setProvider(new MockMailProvider());
    useCompose.getState().close();
    useUi.getState().setAgentOpen(false);
    setViewportWidth(375, 812);
  });

  function renderAt(path: string) {
    return render(
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route element={<MobileShell />}>
            <Route path="/inbox" element={<div>inbox screen</div>} />
            <Route path="/inbox/t/:threadId" element={<div>thread screen</div>} />
            <Route path="/brief" element={<div>today screen</div>} />
            <Route path="/screener" element={<div>screener screen</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );
  }

  it('offers the five tab destinations and nothing else', () => {
    renderAt('/inbox');
    const bar = screen.getByTestId('tab-bar');
    const labels = Array.from(bar.querySelectorAll('a')).map((a) =>
      // The accessible name carries the count, so read the visible label.
      a.textContent?.trim(),
    );
    expect(labels).toEqual(['Today', 'Inbox', 'Screener', 'Ledger', 'More']);
  });

  /*
   * The rail's other four destinations have to be somewhere. If More ever
   * stops pointing at them they are reachable only by typing a URL, which on a
   * phone means not at all.
   */
  it('routes More at a screen rather than at nothing', () => {
    renderAt('/inbox');
    expect(screen.getByRole('link', { name: 'More' })).toHaveAttribute('href', '/more');
  });

  /*
   * `ShellLayers` exists because the held-message sheet was once mounted by the
   * Screener alone, and a held result opened from Search opened nothing while
   * the whole app's keyboard went dead behind a sheet nobody could see. A
   * second shell is exactly how that returns.
   */
  it('mounts the same overlay set the desktop shell does', () => {
    const phone = renderAt('/inbox');
    act(() => useCompose.getState().open());
    expect(phone.container.querySelector('[role="dialog"][aria-label="New message"]')).not.toBeNull();
    phone.unmount();

    setViewportWidth(1440, 900);
    act(() => useCompose.getState().close());
    const desktop = render(
      <MemoryRouter initialEntries={['/inbox']}>
        <Routes>
          <Route element={<AppShell />}>
            <Route path="/inbox" element={<div>inbox screen</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );
    act(() => useCompose.getState().open());
    expect(
      desktop.container.querySelector('[role="dialog"][aria-label="New message"]'),
    ).not.toBeNull();
  });

  describe('the compose button', () => {
    it('floats over a mail place', async () => {
      renderAt('/inbox');
      await userEvent.click(screen.getByRole('button', { name: 'Compose' }));
      expect(useCompose.getState().draft).not.toBeNull();
    });

    /*
     * The reader has replaced the list at this width and carries its own reply
     * affordance at the foot. A button for writing to somebody else was
     * landing on top of it.
     */
    it('is gone while a thread is open', () => {
      renderAt('/inbox/t/t-1');
      expect(screen.queryByRole('button', { name: 'Compose' })).toBeNull();
    });

    /* Today and the Screener are about mail that already exists. */
    it('is gone on the screens that are not mail places', () => {
      renderAt('/brief');
      expect(screen.queryByRole('button', { name: 'Compose' })).toBeNull();
    });
  });

  /*
   * §5.5's revoked state "locks the whole shell" but leaves Settings live. On
   * a phone Settings is behind More, so locking all five tabs left exactly one
   * way out — the Connect Gmail button on the screen in front of you — and no
   * route to the account you might want to disconnect instead.
   */
  describe('when the token is revoked', () => {
    it('disables the mail destinations', () => {
      useMail.setState({ revoked: true });
      renderAt('/inbox');
      // No counts yet in this render, so the names are the bare labels.
      for (const label of ['Today', 'Inbox', 'Screener', 'Ledger']) {
        expect(screen.getByRole('link', { name: label })).toHaveAttribute(
          'aria-disabled',
          'true',
        );
      }
      useMail.setState({ revoked: false });
    });

    it('leaves More reachable, because Settings is behind it', () => {
      useMail.setState({ revoked: true });
      renderAt('/inbox');
      expect(screen.getByRole('link', { name: 'More' })).not.toHaveAttribute('aria-disabled');
      useMail.setState({ revoked: false });
    });
  });
});
