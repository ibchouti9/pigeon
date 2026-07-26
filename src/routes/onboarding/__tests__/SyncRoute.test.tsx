import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { SyncRoute } from '../SyncRoute';
import { resetSyncSessionForTest } from '../../../components/onboarding/syncSession';
import { useMail } from '../../../store/mail';
import type { MailProvider, SearchResults } from '../../../data/provider';
import type {
  Account,
  Address,
  HeldSender,
  Message,
  Sender,
  SyncProgress,
  Thread,
} from '../../../types';

/** Captures the `onProgress` callback so the test can drive it by hand. */
class StubSyncProvider implements MailProvider {
  readonly kind = 'mock';
  onProgress: ((p: SyncProgress) => void) | null = null;

  async getAccount(): Promise<Account> {
    return { email: 'marc@ferrum.dev', name: 'Marc Ferrum', connectedAt: new Date().toISOString() };
  }
  sync(onProgress: (p: SyncProgress) => void): Promise<void> {
    this.onProgress = onProgress;
    return new Promise(() => {});
  }
  async getKnownSenders(): Promise<Sender[]> {
    return [];
  }
  async approveKnownSenders(_ids: string[]): Promise<void> {}
  async listThreads(_place: 'inbox' | 'archive'): Promise<Thread[]> {
    return [];
  }
  async getThread(_id: string): Promise<Thread> {
    throw new Error('not implemented');
  }
  async markRead(_id: string, _read: boolean): Promise<void> {}
  async setPlace(_id: string, _place: 'inbox' | 'archive'): Promise<void> {}
  async listHeld(): Promise<HeldSender[]> {
    return [];
  }
  async decideSender(_id: string, _decision: 'approved' | 'declined'): Promise<void> {}
  async undecideSender(_id: string): Promise<void> {}
  async listSenders(_status: 'approved' | 'declined'): Promise<Sender[]> {
    return [];
  }
  async listContacts(): Promise<Address[]> {
    return [];
  }
  async send(): Promise<Message> {
    throw new Error('not implemented');
  }
  async unsend(_messageId: string): Promise<void> {}
  async search(_query: string, _includeHeld: boolean): Promise<SearchResults> {
    return { inbox: [], archive: [], held: [] };
  }
}

function renderRoute() {
  return render(
    <MemoryRouter initialEntries={['/setup/sync']}>
      <Routes>
        <Route path="/setup/sync" element={<SyncRoute />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('O3 sync progress (§5.2b)', () => {
  afterEach(() => {
    resetSyncSessionForTest();
    useMail.setState({ provider: new StubSyncProvider() });
    vi.restoreAllMocks();
  });

  it('reads "Counting your threads" before the total is known, then real counts', async () => {
    const provider = new StubSyncProvider();
    useMail.setState({
      provider,
      account: { email: 'marc@ferrum.dev', name: 'Marc Ferrum', connectedAt: new Date().toISOString() },
    });
    resetSyncSessionForTest();

    renderRoute();
    await waitFor(() => expect(provider.onProgress).not.toBeNull());

    expect(screen.getByText('Counting your threads')).toBeInTheDocument();

    act(() => provider.onProgress!({ total: 11_908, done: 2_000, step: 'history' }));
    expect(await screen.findByText('2,000 of 11,908 threads')).toBeInTheDocument();
  });

  it('enables Continue only once progress reaches 20%', async () => {
    const provider = new StubSyncProvider();
    useMail.setState({
      provider,
      account: { email: 'marc@ferrum.dev', name: 'Marc Ferrum', connectedAt: new Date().toISOString() },
    });
    resetSyncSessionForTest();

    renderRoute();
    await waitFor(() => expect(provider.onProgress).not.toBeNull());

    // 2,000 / 11,908 ≈ 16.8% — below the threshold.
    act(() => provider.onProgress!({ total: 11_908, done: 2_000, step: 'history' }));
    await screen.findByText('2,000 of 11,908 threads');
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled();

    // 2,500 / 11,908 ≈ 21% — at or above the threshold.
    act(() => provider.onProgress!({ total: 11_908, done: 2_500, step: 'history' }));
    await screen.findByText('2,500 of 11,908 threads');
    expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled();
  });
});
