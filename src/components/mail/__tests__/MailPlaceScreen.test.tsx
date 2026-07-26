import { afterEach, describe, expect, it } from 'vitest';
import { fireEvent, render, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type {
  Account,
  Address,
  HeldSender,
  Message,
  Sender,
  SyncProgress,
  Thread,
} from '../../../types';
import type { MailProvider, SearchResults } from '../../../data/provider';
import { useMail } from '../../../store/mail';
import { MailPlaceScreen } from '../MailPlaceScreen';

/** Minimal provider stub — only `setPlace` matters for this test. */
class StubProvider implements MailProvider {
  readonly kind = 'mock';
  async getAccount(): Promise<Account> {
    return { email: 'marc@ferrum.dev', name: 'Marc Ferrum', connectedAt: new Date().toISOString() };
  }
  async sync(_onProgress: (p: SyncProgress) => void): Promise<void> {}
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

function makeThread(id: string, subject: string): Thread {
  return {
    id,
    subject,
    place: 'inbox',
    unread: false,
    lastMessageAt: new Date().toISOString(),
    messages: [
      {
        id: `${id}-m1`,
        threadId: id,
        from: { name: 'Dana Whitlock', email: 'dana@lumenpartners.com' },
        to: [{ name: 'Marc Ferrum', email: 'marc@ferrum.dev' }],
        cc: [],
        subject,
        body: 'Body',
        date: new Date().toISOString(),
        attachments: [],
        isFromUser: false,
      },
    ],
  };
}

function renderInbox(threads: Thread[]) {
  useMail.setState({
    provider: new StubProvider(),
    account: { email: 'marc@ferrum.dev', name: 'Marc Ferrum', connectedAt: new Date().toISOString() },
    inbox: threads,
    archive: [],
    status: { account: 'ready', inbox: 'ready', archive: 'ready', held: 'ready', senders: 'ready' },
    revoked: false,
  });

  return render(
    <MemoryRouter initialEntries={['/inbox']}>
      <Routes>
        <Route path="/inbox" element={<MailPlaceScreen place="inbox" />} />
        <Route path="/inbox/t/:threadId" element={<MailPlaceScreen place="inbox" />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('archiving a thread', () => {
  afterEach(() => {
    useMail.setState({ inbox: [], archive: [] });
  });

  it('pressing e on the cursor row calls the store, moving the thread to the Archive', async () => {
    const threads = [makeThread('t1', 'First'), makeThread('t2', 'Second')];
    renderInbox(threads);

    fireEvent.keyDown(window, { key: 'e' });

    // setPlace is optimistic — the store updates synchronously before the
    // (stubbed, instant) provider call resolves.
    expect(useMail.getState().inbox.map((t) => t.id)).toEqual(['t2']);
    expect(useMail.getState().archive.map((t) => t.id)).toEqual(['t1']);
  });

  it("clicking a row's hover archive button archives that row via the store", async () => {
    const threads = [makeThread('t1', 'First'), makeThread('t2', 'Second')];
    const { container } = renderInbox(threads);

    const archiveButtons = container.querySelectorAll('button[aria-label="Archive"]');
    // The first icon-labelled "Archive" button belongs to the first row.
    fireEvent.click(archiveButtons[0]);

    // §4.6 — the row plays its departure before the archive is handed up, so
    // this lands one animation later rather than synchronously.
    await waitFor(() => {
      expect(useMail.getState().inbox.map((t) => t.id)).toEqual(['t2']);
    });
    expect(useMail.getState().archive.map((t) => t.id)).toEqual(['t1']);
  });
});
