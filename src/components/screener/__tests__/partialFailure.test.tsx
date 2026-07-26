import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { useMail } from '../../../store/mail';
import { useUi } from '../../../store/ui';
import { MockMailProvider } from '../../../data/mock/mockProvider';
import { ScreenerRoute } from '../../../routes/ScreenerRoute';
import { MailError } from '../../../data/provider';

/**
 * §3.3 3b — a partial bulk failure returns the failed rows with a destructive
 * outline and an inline retry.
 *
 * None of that survived, because the route decided the Screener was empty
 * while the decision was still in flight. Every row leaves optimistically, so
 * `held` reads zero for the whole round-trip; the empty state rendered, which
 * unmounted the list, which threw away the failed set and the selection — and
 * then the rollback brought the rows back as plain, un-retryable rows. With
 * enough rows the delayed jump back to Stack fired too, and the failures ended
 * up on a screen that cannot show them at all.
 */
describe('a bulk decision that partly fails (§3.3 3b)', () => {
  /** Fails every sender whose id is in `failing`, succeeds on the rest. */
  class PartialProvider extends MockMailProvider {
    private failing: Set<string>;

    constructor(failing: string[]) {
      super();
      this.failing = new Set(failing);
    }

    override async decideSender(
      senderId: string,
      decision: 'approved' | 'declined',
    ): Promise<void> {
      if (this.failing.has(senderId)) {
        // Deliberately longer than the route's 400ms empty-state settle, so the
        // zero reading outlives the debounce. That is the case the debounce
        // alone can't cover and the in-flight count has to.
        await new Promise((r) => setTimeout(r, 450));
        throw new MailError('nope', 'unreachable');
      }
      return super.decideSender(senderId, decision);
    }
  }

  beforeEach(() => {
    localStorage.clear();
    MockMailProvider.reset();
  });

  afterEach(async () => {
    await waitFor(() => expect(useMail.getState().deciding).toBe(0), { timeout: 5000 });
    cleanup();
    useUi.setState({ heldSheetSenderId: null, dialog: null, shortcutsOpen: false });
  });

  async function setup(failing: string[]) {
    const provider = new PartialProvider(failing);
    useMail.getState().setProvider(provider);
    await useMail.getState().loadHeld();

    render(
      <MemoryRouter initialEntries={['/screener?view=list']}>
        <Routes>
          <Route path="/screener" element={<ScreenerRoute />} />
          <Route path="/screener/s/:senderId" element={<ScreenerRoute />} />
        </Routes>
      </MemoryRouter>,
    );
    return provider;
  }

  function heldIds(): string[] {
    return useMail.getState().held.map((h) => h.sender.id);
  }

  it('brings the failed rows back with an inline retry, in the list', async () => {
    const user = userEvent.setup();
    const all = (await (async () => {
      useMail.getState().setProvider(new MockMailProvider());
      await useMail.getState().loadHeld();
      return heldIds();
    })()) as string[];
    const failing = all.slice(0, 1);

    await setup(failing);
    await screen.findByLabelText(/Select all/);

    await user.click(screen.getByLabelText(/Select all/));
    await user.click(screen.getByRole('button', { name: 'Approve senders' }));

    // The failed rows come back, and they come back here — not on the Stack.
    await waitFor(() => expect(heldIds()).toEqual(failing), { timeout: 3000 });
    const retries = await screen.findAllByRole('button', { name: 'Try again' });
    // One per failed row, plus the toast's.
    expect(retries.length).toBeGreaterThanOrEqual(failing.length);

    // One outlined row per failure, each carrying its own retry. Match on the
    // row class specifically — the inline retry span is hashed "failedInline"
    // and would otherwise be counted as a row of its own.
    const failedRows = Array.from(
      document.querySelectorAll('[class*="_row_"][class*="_failed_"]'),
    ).filter((el) => within(el as HTMLElement).queryByRole('button', { name: 'Try again' }));
    expect(failedRows).toHaveLength(failing.length);

    for (const held of useMail.getState().held) {
      const row = failedRows.find((el) => el.textContent?.includes(held.sender.name));
      expect(row, `no failed row for ${held.sender.name}`).toBeTruthy();
    }
  });

  it('never shows the empty state while the decision is still resolving', async () => {
    const user = userEvent.setup();
    const all = (await (async () => {
      useMail.getState().setProvider(new MockMailProvider());
      await useMail.getState().loadHeld();
      return heldIds();
    })()) as string[];

    await setup(all.slice(0, 1));
    await screen.findByLabelText(/Select all/);

    await user.click(screen.getByLabelText(/Select all/));
    await user.click(screen.getByRole('button', { name: 'Approve senders' }));

    // `held` is zero here, but one of them is coming back.
    expect(useMail.getState().deciding).toBeGreaterThan(0);
    expect(screen.queryByText('Nothing waiting.')).not.toBeInTheDocument();

    await waitFor(() => expect(useMail.getState().deciding).toBe(0));
    expect(screen.queryByText('Nothing waiting.')).not.toBeInTheDocument();
  });

  it('still reaches the empty state when everything succeeds', async () => {
    const user = userEvent.setup();
    await setup([]);
    await screen.findByLabelText(/Select all/);

    await user.click(screen.getByLabelText(/Select all/));
    await user.click(screen.getByRole('button', { name: 'Approve senders' }));

    await screen.findByText('Nothing waiting.', undefined, { timeout: 3000 });
  });

  it('counts in-flight decisions back down even when they throw', async () => {
    await setup(['does-not-matter']);
    expect(useMail.getState().deciding).toBe(0);

    const ids = heldIds();
    const pending = useMail.getState().decideMany(ids, 'declined');
    expect(useMail.getState().deciding).toBe(1);

    await pending;
    expect(useMail.getState().deciding).toBe(0);
  });
});
