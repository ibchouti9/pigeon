import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useMail } from '../../../store/mail';
import { useUi } from '../../../store/ui';
import { useToasts } from '../../../store/toast';
import { MockMailProvider } from '../../../data/mock/mockProvider';
import { CardStack } from '../CardStack';

/**
 * §3.2 3c — undoing a decision "reverses server-side, the card returns to the
 * top of the stack". `listHeld` re-sorts by newest message, and the stack kept
 * pointing at whichever card had already risen, so the restored sender came
 * back somewhere down the queue. From the user's side the undo looked like it
 * had silently failed.
 */
describe('undo returns the card to the top (§3.2 3c)', () => {
  function Harness() {
    const held = useMail((s) => s.held);
    return (
      <CardStack
        held={held}
        status="ready"
        reads={{}}
        online
        onRead={() => {}}
        onToggleView={() => {}}
      />
    );
  }

  beforeEach(async () => {
    localStorage.clear();
    MockMailProvider.reset();
    useMail.getState().setProvider(new MockMailProvider());
    useMail.setState({ restoredSenderId: null });
    useToasts.setState({ toasts: [] });
    useUi.setState({ heldSheetSenderId: null, dialog: null, shortcutsOpen: false });
    await useMail.getState().loadHeld();
  });

  afterEach(cleanup);

  function topCardName(): string {
    return screen.getAllByRole('heading', { level: 2 })[0]?.textContent ?? '';
  }

  it('puts the undone sender back on top, not back in date order', async () => {
    const user = userEvent.setup();
    const first = useMail.getState().held[0];
    render(<Harness />);

    expect(topCardName()).toBe(first.sender.name);

    await user.click(screen.getByRole('button', { name: /Approve sender/ }));
    await waitFor(() => expect(topCardName()).not.toBe(first.sender.name));

    // The toast host lives in the shell; this is the same path its Undo takes.
    await waitFor(() => expect(useToasts.getState().toasts[0]?.action).toBeTruthy());
    await act(async () => {
      useToasts.getState().undoNewest();
    });

    await waitFor(() => expect(topCardName()).toBe(first.sender.name));
    // Consumed once the fade has run, so a later re-render doesn't yank the
    // stack back again. Cleared on the timer rather than immediately: clearing
    // it first cancelled the very timer meant to reset the animation.
    await waitFor(() => expect(useMail.getState().restoredSenderId).toBeNull());
  });

  it('fades the card in rather than replaying the stamp', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole('button', { name: /Approve sender/ }));
    await waitFor(() => expect(useToasts.getState().toasts[0]?.action).toBeTruthy());
    await act(async () => {
      useToasts.getState().undoNewest();
    });

    await waitFor(() => {
      expect(document.querySelector('[class*="_restoring_"]')).toBeTruthy();
    });
    expect(document.querySelector('[class*="_rising_"]')).toBeNull();

    // And it comes off again, so the next decision animates from a clean slate.
    await waitFor(() => expect(document.querySelector('[class*="_restoring_"]')).toBeNull());
  });
});
