import { afterEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { KnownSendersRoute } from '../KnownSendersRoute';
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

const SENDERS: Sender[] = [
  { id: 's1', name: 'Dana Whitlock', email: 'dana@lumenpartners.com', status: 'unknown', knownReason: 'replies', replyCount: 24 },
  { id: 's2', name: 'Marc Ferrum jr', email: 'marc.jr@ferrum.dev', status: 'unknown', knownReason: 'contact' },
  { id: 's3', name: 'Sana Sethi', email: 'sana@northbound.io', status: 'unknown', knownReason: 'replies', replyCount: 11 },
  { id: 's4', name: 'Atlas CI', email: 'noreply@atlas-ci.com', status: 'unknown', knownReason: 'contact' },
  { id: 's5', name: 'Kenji Aoki', email: 'kenji@aoki.dev', status: 'unknown', knownReason: 'replies', replyCount: 19 },
];

class StubSendersProvider implements MailProvider {
  readonly kind = 'mock';
  approved: string[] | null = null;

  async getAccount(): Promise<Account> {
    return { email: 'marc@ferrum.dev', name: 'Marc Ferrum', connectedAt: new Date().toISOString() };
  }
  async sync(_onProgress: (p: SyncProgress) => void): Promise<void> {}
  async getKnownSenders(): Promise<Sender[]> {
    return SENDERS.map((s) => ({ ...s }));
  }
  async approveKnownSenders(ids: string[]): Promise<void> {
    this.approved = ids;
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

async function renderRoute() {
  const provider = new StubSendersProvider();
  useMail.setState({ provider });
  render(
    <MemoryRouter initialEntries={['/setup/senders']}>
      <Routes>
        <Route path="/setup/senders" element={<KnownSendersRoute />} />
      </Routes>
    </MemoryRouter>,
  );
  await screen.findByRole('button', { name: 'Approve 5 senders' });
  return provider;
}

/** §5.3 O4 — the live Approve-N-senders label and the untick-all toggle. */
describe('O4 known senders — live label and untick all', () => {
  afterEach(() => {
    useMail.setState({ provider: new StubSendersProvider() });
  });

  it('starts with everyone ticked and reads "Approve 5 senders"', async () => {
    await renderRoute();
    expect(screen.getByRole('button', { name: 'Untick all' })).toBeInTheDocument();
  });

  it('unticking one sender updates the live count', async () => {
    await renderRoute();

    fireEvent.click(screen.getByRole('checkbox', { name: 'Dana Whitlock' }));

    expect(await screen.findByRole('button', { name: 'Approve 4 senders' })).toBeInTheDocument();
  });

  it('Untick all clears every checkbox, flips its own label, and shows the helper line', async () => {
    await renderRoute();

    fireEvent.click(screen.getByRole('button', { name: 'Untick all' }));

    expect(
      await screen.findByRole('button', { name: 'Continue with no approved senders' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Tick all' })).toBeInTheDocument();
    expect(
      screen.getByText('Everything new will start in the Screener until you approve someone.'),
    ).toBeInTheDocument();
    for (const s of SENDERS) {
      expect(screen.getByRole('checkbox', { name: s.name })).not.toBeChecked();
    }

    fireEvent.click(screen.getByRole('button', { name: 'Tick all' }));

    expect(await screen.findByRole('button', { name: 'Approve 5 senders' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Untick all' })).toBeInTheDocument();
  });
});
