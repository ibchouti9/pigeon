import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { MockMailProvider } from '../../../data/mock/mockProvider';
import { MailError } from '../../../data/provider';
import { useMail } from '../../../store/mail';
import type { Thread } from '../../../types';
import { MailPlaceScreen } from '../MailPlaceScreen';

/**
 * The reader resolved the open thread out of the loaded list alone. A reader
 * URL for anything else — a bookmark, a link someone was sent, or on a real
 * Gmail account any thread past the walk's 2,000-thread ceiling — landed on
 * §5.6's "This thread didn't load" with a "Try again" that reloads the same
 * list and still won't contain it. A dead end that reads as a failure.
 *
 * `getThread` is on both providers and was called by nothing.
 */

function makeThread(id: string, subject: string): Thread {
  return {
    id,
    subject,
    place: 'archive',
    unread: false,
    lastMessageAt: '2026-07-20T09:00:00.000Z',
    messages: [
      {
        id: `${id}-m1`,
        threadId: id,
        from: { name: 'Dana Whitlock', email: 'dana@lumenpartners.com' },
        to: [{ name: 'Marc Ferrum', email: 'marc@ferrum.dev' }],
        cc: [],
        subject,
        body: 'The body of a thread the list never held.',
        date: '2026-07-20T09:00:00.000Z',
        attachments: [],
        isFromUser: false,
      },
    ],
  };
}

function deferred() {
  let resolve: (t: Thread) => void = () => {};
  const promise = new Promise<Thread>((r) => (resolve = r));
  return { resolve, promise };
}

/** Runs the component's own `.then` and flushes the render it queues. */
async function settle(promise: Promise<unknown>) {
  await act(async () => {
    await promise;
    await Promise.resolve();
    await Promise.resolve();
  });
}

let navigateTo: (path: string) => void = () => {};

function NavigateHandle() {
  navigateTo = useNavigate();
  return null;
}

function renderAt(threadId: string) {
  useMail.setState({
    account: { email: 'marc@ferrum.dev', name: 'Marc Ferrum', connectedAt: '2026-07-01T00:00:00.000Z' },
    inbox: [],
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
    <MemoryRouter initialEntries={[`/inbox/t/${threadId}`]}>
      <NavigateHandle />
      <Routes>
        <Route path="/inbox/t/:threadId" element={<MailPlaceScreen place="inbox" />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('a reader URL for a thread the list does not hold', () => {
  beforeEach(() => {
    localStorage.clear();
    MockMailProvider.reset();
    useMail.setState({ provider: new MockMailProvider() });
  });

  afterEach(() => {
    useMail.setState({ inbox: [], archive: [] });
    vi.restoreAllMocks();
  });

  it('fetches the thread and reads it', async () => {
    const thread = makeThread('beyond-the-cap', 'Contract redlines');
    const getThread = vi
      .spyOn(useMail.getState().provider, 'getThread')
      .mockResolvedValue(thread);

    renderAt('beyond-the-cap');

    expect(await screen.findByText('Contract redlines')).toBeInTheDocument();
    expect(getThread).toHaveBeenCalledWith('beyond-the-cap');
  });

  it('shows §5.6’s error only once the provider has actually refused', async () => {
    vi.spyOn(useMail.getState().provider, 'getThread').mockRejectedValue(
      new MailError('gone', 'not-found'),
    );

    renderAt('no-such-thread');

    expect(
      await screen.findByText("This thread didn't load. It's still in Gmail."),
    ).toBeInTheDocument();
  });

  it('does not claim a failure while the fetch is still in flight', async () => {
    vi.spyOn(useMail.getState().provider, 'getThread').mockImplementation(
      () => new Promise(() => {}),
    );

    renderAt('slow-thread');

    // A pending request is not a failure. Asserting after a tick, so a
    // synchronous error state would have rendered by now.
    await Promise.resolve();
    expect(
      screen.queryByText("This thread didn't load. It's still in Gmail."),
    ).not.toBeInTheDocument();
  });

  /**
   * Both halves of this matter. Asserting only the absence passes before the
   * promise has even settled, which is how the first version of it went green
   * against a component with no epoch guard at all.
   */
  it('shows a thread that lands while the account is unchanged', async () => {
    const { resolve, promise } = deferred();
    vi.spyOn(useMail.getState().provider, 'getThread').mockReturnValue(promise);

    renderAt('beyond-the-cap');
    resolve(makeThread('beyond-the-cap', 'Contract redlines'));
    await settle(promise);

    expect(screen.getByText('Contract redlines')).toBeInTheDocument();
  });

  it('ignores a thread that lands after the account was swapped', async () => {
    const { resolve, promise } = deferred();
    vi.spyOn(useMail.getState().provider, 'getThread').mockReturnValue(promise);

    renderAt('beyond-the-cap');

    // Disconnecting mid-fetch is exactly when another account's thread would
    // otherwise land on screen.
    useMail.getState().setProvider(new MockMailProvider());
    resolve(makeThread('beyond-the-cap', 'Contract redlines'));
    await settle(promise);

    expect(screen.queryByText('Contract redlines')).not.toBeInTheDocument();
  });

  it('does not put a thread on screen after the reader moved to another one', async () => {
    const { resolve, promise } = deferred();
    const getThread = vi.spyOn(useMail.getState().provider, 'getThread');
    getThread.mockReturnValueOnce(promise);
    getThread.mockResolvedValue(makeThread('second', 'The one being read'));

    renderAt('first');

    // A real navigation, not a re-render: MemoryRouter reads initialEntries
    // only on mount, so re-rendering it with a different URL changes nothing.
    await act(async () => {
      navigateTo('/inbox/t/second');
    });

    resolve(makeThread('first', 'The one navigated away from'));
    await settle(promise);

    expect(screen.queryByText('The one navigated away from')).not.toBeInTheDocument();
    expect(await screen.findByText('The one being read')).toBeInTheDocument();
  });

  it('does not keep the last fetched thread on screen while the next one loads', async () => {
    const getThread = vi.spyOn(useMail.getState().provider, 'getThread');
    getThread.mockResolvedValueOnce(makeThread('first', 'The one already read'));
    // The second never lands, so whatever is on screen is what the user is
    // left looking at.
    getThread.mockReturnValueOnce(new Promise(() => {}));

    renderAt('first');
    expect(await screen.findByText('The one already read')).toBeInTheDocument();

    await act(async () => {
      navigateTo('/inbox/t/second');
    });

    expect(screen.queryByText('The one already read')).not.toBeInTheDocument();
  });

  it('does not go looking while the list is still loading', async () => {
    const getThread = vi.spyOn(useMail.getState().provider, 'getThread');

    useMail.setState((s) => ({ status: { ...s.status, inbox: 'loading' } }));
    render(
      <MemoryRouter initialEntries={['/inbox/t/t1']}>
        <Routes>
          <Route path="/inbox/t/:threadId" element={<MailPlaceScreen place="inbox" />} />
        </Routes>
      </MemoryRouter>,
    );

    // The list may well be about to deliver it; a second request for the same
    // thread is wasted on Gmail, where threads.get costs 40 quota units.
    await Promise.resolve();
    expect(getThread).not.toHaveBeenCalled();
  });
});
