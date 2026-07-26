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
  known: Sender[] = [];
  approved: string[] = [];

  async getKnownSenders(): Promise<Sender[]> {
    return this.known;
  }
  async approveKnownSenders(ids: string[]): Promise<void> {
    this.approved.push(...ids);
  }
  async listThreads(_place: 'inbox' | 'archive'): Promise<Thread[]> {
    return [];
  }
  hasOlder(_place: 'inbox' | 'archive'): boolean {
    return false;
  }
  async listOlder(_place: 'inbox' | 'archive'): Promise<Thread[]> {
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
  async downloadAttachment(_m: string, _a: string): Promise<string> {
    return '';
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
        <Route path="/setup/senders" element={<p>O4 known senders</p>} />
        <Route path="/setup/screener" element={<p>O5 screener intro</p>} />
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

  /**
   * D34 wants the mailbox's real size on this screen, and `total` is now exactly
   * that — the engine counts every conversation in the place even though it
   * lists a window of them. The old line read "2,000 of 11,908 threads", which
   * measured a walk that fetched every message in the mailbox; that walk is
   * gone, and reporting the window against the total would announce the mail
   * ready at half a percent.
   */
  it('names the size of the mailbox once the engine has counted it', async () => {
    const provider = new StubSyncProvider();
    useMail.setState({
      provider,
      account: { email: 'marc@ferrum.dev', name: 'Marc Ferrum', connectedAt: new Date().toISOString() },
    });
    resetSyncSessionForTest();

    renderRoute();
    await waitFor(() => expect(provider.onProgress).not.toBeNull());

    expect(screen.getByText('Reading your mail')).toBeInTheDocument();

    act(() => provider.onProgress!({ total: 11_908, done: 200, step: 'history' }));
    expect(await screen.findByText('11,908 conversations in your inbox')).toBeInTheDocument();
  });

  /**
   * §5.2b's escape hatch, on the steps rather than on a percentage. "Continue at
   * 20%" existed because the other 80% was a walk over the whole mailbox; what
   * it was *for* — never trapping someone on this screen — is kept by opening
   * Continue as soon as the mail step is under way.
   */
  it('opens Continue once the mail step has started, and not before', async () => {
    const provider = new StubSyncProvider();
    useMail.setState({
      provider,
      account: { email: 'marc@ferrum.dev', name: 'Marc Ferrum', connectedAt: new Date().toISOString() },
    });
    resetSyncSessionForTest();

    renderRoute();
    await waitFor(() => expect(provider.onProgress).not.toBeNull());

    act(() => provider.onProgress!({ total: null, done: 0, step: 'contacts' }));
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled();

    act(() => provider.onProgress!({ total: 11_908, done: 0, step: 'history' }));
    await screen.findByText('11,908 conversations in your inbox');
    expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled();
  });

  /**
   * §3.1 3c — a quiet account skips O4, but "known senders are seeded from
   * Contacts only". Skipping the screen skipped the seeding with it, so every
   * contact landed in the Screener and the user had to approve people they
   * already had in their address book.
   */
  describe('the quiet-account branch (§3.1 3c)', () => {
    function quietProvider() {
      const provider = new StubSyncProvider();
      provider.known = [
        { id: 'dana', name: 'Dana', email: 'dana@lumen.com', status: 'unknown', knownReason: 'contact' },
        { id: 'sana', name: 'Sana', email: 'sana@north.io', status: 'unknown', knownReason: 'contact' },
        { id: 'ci', name: 'CI', email: 'ci@atlas.dev', status: 'unknown', knownReason: 'replies' },
      ];
      useMail.setState({
        provider,
        account: {
          email: 'marc@ferrum.dev',
          name: 'Marc Ferrum',
          connectedAt: new Date().toISOString(),
        },
      });
      resetSyncSessionForTest();
      return provider;
    }

    it('approves the contacts, and only the contacts, before skipping to O5', async () => {
      const provider = quietProvider();
      renderRoute();
      await waitFor(() => expect(provider.onProgress).not.toBeNull());

      act(() => provider.onProgress!({ total: 12, done: 12, step: 'complete' }));
      const button = await screen.findByRole('button', { name: 'Continue' });
      button.click();

      await waitFor(() => expect(provider.approved).toEqual(['dana', 'sana']));
      expect(await screen.findByText('O5 screener intro')).toBeInTheDocument();
    });

    /**
     * §3.1 3c is about the account's *total* threads, which is what sync
     * counted — not what Pigeon has walked. The walk stops at 2,000 a place,
     * and the demo account reports a sync of 11,908 while its seed holds 22,
     * so measuring the walked lists made every demo run look quiet: O4 was
     * skipped and its 342 known senders were never offered.
     */
    it('shows O4 for a busy account even when few threads have been walked', async () => {
      const provider = quietProvider();
      // The stub's listThreads returns nothing, standing in for a walk that has
      // not caught up with the count.
      renderRoute();
      await waitFor(() => expect(provider.onProgress).not.toBeNull());

      act(() => provider.onProgress!({ total: 11_908, done: 11_908, step: 'complete' }));
      (await screen.findByRole('button', { name: 'Continue' })).click();

      expect(await screen.findByText('O4 known senders')).toBeInTheDocument();
      // O4 is where the user approves; nothing is approved on their behalf.
      expect(provider.approved).toEqual([]);
    });

    /**
     * Nothing on this path may strand the user. A provider that throws used to
     * leave Continue un-spun and inert, with no error state and no way forward.
     */
    it('moves on to O4 when the provider throws', async () => {
      const provider = quietProvider();
      provider.getKnownSenders = () => Promise.reject(new Error('gone'));
      provider.listThreads = () => Promise.reject(new Error('gone'));
      renderRoute();
      await waitFor(() => expect(provider.onProgress).not.toBeNull());

      // Total unknown, so the count falls back to the walk — which fails.
      act(() => provider.onProgress!({ total: null, done: 0, step: 'complete' }));
      (await screen.findByRole('button', { name: 'Continue' })).click();

      // O4 has its own error state for a sender list that won't load, and
      // nothing has been decided on the user's behalf.
      expect(await screen.findByText('O4 known senders')).toBeInTheDocument();
      expect(provider.approved).toEqual([]);
    });

    it('reaches O5 even when seeding the contacts fails', async () => {
      const provider = quietProvider();
      provider.approveKnownSenders = () => Promise.reject(new Error('gone'));
      renderRoute();
      await waitFor(() => expect(provider.onProgress).not.toBeNull());

      act(() => provider.onProgress!({ total: 12, done: 12, step: 'complete' }));
      (await screen.findByRole('button', { name: 'Continue' })).click();

      // The seeding is an optimisation; those senders just wait in the
      // Screener, where the user can see them.
      expect(await screen.findByText('O5 screener intro')).toBeInTheDocument();
    });

    it('still skips O4 when the account really is that small', async () => {
      const provider = quietProvider();
      renderRoute();
      await waitFor(() => expect(provider.onProgress).not.toBeNull());

      act(() => provider.onProgress!({ total: 49, done: 49, step: 'complete' }));
      (await screen.findByRole('button', { name: 'Continue' })).click();

      expect(await screen.findByText('O5 screener intro')).toBeInTheDocument();
    });
  });
});
