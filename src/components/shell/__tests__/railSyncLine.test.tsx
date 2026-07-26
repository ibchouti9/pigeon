import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { useMail } from '../../../store/mail';
import { MockMailProvider } from '../../../data/mock/mockProvider';
import type { SyncProgress } from '../../../types';
import { NavRail } from '../NavRail';

const sync = vi.hoisted(() => {
  let latest: SyncProgress = { total: null, done: 0, step: 'connect' };
  const listeners = new Set<(p: SyncProgress) => void>();
  return {
    getSyncProgress: () => latest,
    subscribeSync: (l: (p: SyncProgress) => void) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    emit(p: SyncProgress) {
      latest = p;
      for (const l of listeners) l(p);
    },
    reset() {
      latest = { total: null, done: 0, step: 'connect' };
      listeners.clear();
    },
  };
});

vi.mock('../../onboarding/syncSession', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../onboarding/syncSession')>();
  return { ...actual, getSyncProgress: sync.getSyncProgress, subscribeSync: sync.subscribeSync };
});

/**
 * §3.1 3a — Continue is allowed from 20%, and "remaining sync continues in the
 * background and reports in the rail as a thin progress line under the account
 * name". Nothing in the shell subscribed to it, so the rest of the sync
 * finished invisibly and a partly-loaded inbox looked like the whole mailbox.
 */
describe('the rail sync line (§3.1 3a)', () => {
  beforeEach(() => {
    localStorage.clear();
    MockMailProvider.reset();
    useMail.getState().setProvider(new MockMailProvider());
    sync.reset();
  });

  afterEach(cleanup);

  function renderRail() {
    render(
      <MemoryRouter>
        <NavRail compact={false} searchRef={{ current: null }} />
      </MemoryRouter>,
    );
  }

  const bar = () => screen.queryByRole('progressbar', { name: 'Still syncing your mail' });

  it('shows nothing before a total is known', () => {
    renderRail();
    expect(bar()).toBeNull();
  });

  it('reports progress while sync is still running', () => {
    renderRail();
    act(() => sync.emit({ total: 11_908, done: 2_977, step: 'history' }));

    const line = bar();
    expect(line).toBeInTheDocument();
    expect(line).toHaveAttribute('aria-valuenow', '25');
  });

  it('disappears once sync completes', () => {
    renderRail();
    act(() => sync.emit({ total: 11_908, done: 6_000, step: 'history' }));
    expect(bar()).toBeInTheDocument();

    act(() => sync.emit({ total: 11_908, done: 11_908, step: 'complete' }));
    expect(bar()).toBeNull();
  });

  it('stays out of the way when sync failed — O3 owns that message', () => {
    renderRail();
    act(() =>
      sync.emit({ total: 11_908, done: 4_312, step: 'history', error: 'Gmail returned an error.' }),
    );
    expect(bar()).toBeNull();
  });

  it('is not rendered in the compact rail, which has no account text', () => {
    render(
      <MemoryRouter>
        <NavRail compact searchRef={{ current: null }} />
      </MemoryRouter>,
    );
    act(() => sync.emit({ total: 100, done: 40, step: 'history' }));
    expect(bar()).toBeNull();
  });
});
