import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { useCompose } from '../../../store/compose';
import { useMail } from '../../../store/mail';
import { MockMailProvider } from '../../../data/mock/mockProvider';
import { NavRail } from '../NavRail';

/**
 * §5.4 — offline, "archive and compose controls are disabled with
 * `aria-disabled="true"`". Everything else on the screen honoured that; the
 * rail's Compose button stayed live and opened a composer that could only
 * refuse to send.
 */
describe('the rail Compose control offline', () => {
  function setOnline(value: boolean) {
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => value });
    window.dispatchEvent(new Event(value ? 'online' : 'offline'));
  }

  beforeEach(() => {
    localStorage.clear();
    MockMailProvider.reset();
    useMail.getState().setProvider(new MockMailProvider());
    useCompose.getState().close();
  });

  afterEach(() => setOnline(true));

  function renderRail() {
    return render(
      <MemoryRouter>
        <NavRail compact={false} searchRef={{ current: null }} />
      </MemoryRouter>,
    );
  }

  it('opens a draft when online', async () => {
    setOnline(true);
    renderRail();

    await userEvent.click(screen.getByRole('button', { name: 'Compose' }));
    expect(useCompose.getState().draft).not.toBeNull();
  });

  it('is marked aria-disabled and opens nothing when offline', async () => {
    setOnline(false);
    renderRail();

    const compose = screen.getByRole('button', { name: 'Compose' });
    expect(compose).toHaveAttribute('aria-disabled', 'true');

    await userEvent.click(compose);
    expect(useCompose.getState().draft).toBeNull();
  });

  it('keeps its tab stop while disabled', () => {
    setOnline(false);
    renderRail();

    // aria-disabled, not `disabled` — a removed tab stop is a worse experience
    // than a focusable control that explains why it can't act.
    const compose = screen.getByRole('button', { name: 'Compose' });
    expect(compose).not.toBeDisabled();
    compose.focus();
    expect(compose).toHaveFocus();
  });
});
