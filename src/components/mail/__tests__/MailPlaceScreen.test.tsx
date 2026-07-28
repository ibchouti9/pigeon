import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { MockMailProvider } from '../../../data/mock/mockProvider';
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
    status: {
      account: 'ready',
      inbox: 'ready',
      archive: 'ready',
      sent: 'ready',
      drafts: 'ready',
      held: 'ready',
      senders: 'ready',
    },
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

/**
 * `?scenario=` is how §8.5 item 1's dev harness picks which empty/loading/error
 * state a screen renders. Every navigation inside a place used to rebuild the
 * path from scratch, so opening the first thread dropped the parameter and the
 * harness stopped saying which state it was showing.
 */
describe('navigation inside a place keeps the query string', () => {
  beforeEach(() => {
    localStorage.clear();
    MockMailProvider.reset();
    useMail.getState().setProvider(new MockMailProvider());
  });

  it('carries ?scenario through opening and closing a thread', async () => {
    const user = userEvent.setup();
    await useMail.getState().loadThreads('inbox');
    const first = useMail.getState().inbox[0];
    let url = '';
    function Spy() {
      const location = useLocation();
      url = location.pathname + location.search;
      return null;
    }

    render(
      <MemoryRouter initialEntries={['/inbox?scenario=normal']}>
        <Routes>
          <Route path="/inbox" element={<MailPlaceScreen place="inbox" />} />
          <Route path="/inbox/t/:threadId" element={<MailPlaceScreen place="inbox" />} />
        </Routes>
        <Spy />
      </MemoryRouter>,
    );

    const sender =
      first.messages.find((m) => !m.isFromUser)?.from ?? first.messages[0].from;
    const row = await screen.findByRole('button', {
      name: new RegExp(sender.name || sender.email),
    });
    await user.click(row);

    await waitFor(() => expect(url).toMatch(/^\/inbox\/t\/.+\?scenario=normal$/));
  });
});
