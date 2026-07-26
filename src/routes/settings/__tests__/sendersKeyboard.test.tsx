import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { useMail } from '../../../store/mail';
import { useUi } from '../../../store/ui';
import { MockMailProvider } from '../../../data/mock/mockProvider';
import { SendersSettings } from '../SendersSettings';

/**
 * §8.1 puts sender lists in the thread-list scope. Nothing was bound here.
 * Every row's action button is tabbable, so no row was strictly unreachable —
 * but the list is virtualized and can run to hundreds of rows, and tabbing to
 * row 300 is not a way anyone would choose to get there.
 */
describe('sender list keyboard (§8.1)', () => {
  beforeEach(() => {
    localStorage.clear();
    MockMailProvider.reset();
    useMail.getState().setProvider(new MockMailProvider());
    useUi.setState({ heldSheetSenderId: null, dialog: null, shortcutsOpen: false });
    Element.prototype.scrollTo = () => {};
  });

  afterEach(cleanup);

  async function renderSenders() {
    render(
      <MemoryRouter>
        <SendersSettings />
      </MemoryRouter>,
    );
    await waitFor(() => expect(document.querySelectorAll('[data-sender-row]').length).toBeGreaterThan(1), {
      timeout: 3000,
    });
  }

  function cursorRow(): number {
    const row = document.querySelector<HTMLElement>('[class*="_cursor_"]');
    return row ? Number(row.dataset.senderRow) : -1;
  }

  it('starts on the first row', async () => {
    await renderSenders();
    expect(cursorRow()).toBe(0);
  });

  it('moves down and up with j and k', async () => {
    const user = userEvent.setup();
    await renderSenders();

    await user.keyboard('j');
    expect(cursorRow()).toBe(1);
    await user.keyboard('j');
    expect(cursorRow()).toBe(2);
    await user.keyboard('k');
    expect(cursorRow()).toBe(1);
  });

  it('stops at the top rather than wrapping', async () => {
    const user = userEvent.setup();
    await renderSenders();

    await user.keyboard('kkk');
    expect(cursorRow()).toBe(0);
  });

  /**
   * The cursor used to land on the row's action button, which §5.13b makes
   * "Decline" on the Approved tab. So `j` `j` `Enter` declined a sender —
   * while §8.1's Enter is "open the cursor row", and a sender row has nothing
   * to open. The button is one Tab away, which is where a decision belongs.
   */
  it('gives the cursor row focus, not its destructive button', async () => {
    const user = userEvent.setup();
    await renderSenders();

    await user.keyboard('j');
    await waitFor(() => {
      const active = document.activeElement as HTMLElement;
      expect(active.getAttribute('data-sender-row')).toBe('1');
    });
  });

  it('does not reverse a decision on Enter', async () => {
    const user = userEvent.setup();
    await renderSenders();
    const approvedBefore = useMail.getState().approved.length;

    await user.keyboard('j');
    await waitFor(() =>
      expect((document.activeElement as HTMLElement).getAttribute('data-sender-row')).toBe('1'),
    );
    await user.keyboard('{Enter}');

    expect(useMail.getState().approved.length).toBe(approvedBefore);
  });

  it('still reaches the action button with Tab', async () => {
    const user = userEvent.setup();
    await renderSenders();

    await user.keyboard('j');
    await waitFor(() =>
      expect((document.activeElement as HTMLElement).getAttribute('data-sender-row')).toBe('1'),
    );
    await user.tab();

    const active = document.activeElement as HTMLElement;
    expect(active.tagName).toBe('BUTTON');
    expect(active.closest('[data-sender-row]')?.getAttribute('data-sender-row')).toBe('1');
  });

  it('resets to the top when the filter changes', async () => {
    const user = userEvent.setup();
    await renderSenders();

    await user.keyboard('jj');
    expect(cursorRow()).toBe(2);

    await user.type(screen.getByRole('searchbox'), 'a');
    await waitFor(() => expect(cursorRow()).toBe(0));
  });
});
