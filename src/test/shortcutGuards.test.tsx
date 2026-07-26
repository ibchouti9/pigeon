import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { useMail } from '../store/mail';
import { shortcutsBlocked, useUi } from '../store/ui';
import { useCompose } from '../store/compose';
import { useToasts, toast } from '../store/toast';
import { MockMailProvider } from '../data/mock/mockProvider';
import { ScreenerRoute } from '../routes/ScreenerRoute';
import { useGlobalShortcuts } from '../hooks/useGlobalShortcuts';

/**
 * §8.1 — "Shortcuts are single keys with no modifier except where noted, and
 * are disabled while focus is inside a text field". Three ways that was broken:
 *
 *   - The Screener switched on `e.key` with no modifier check, so ⌘A (select
 *     all, on reflex) approved the top sender and ⌘D declined it.
 *   - ⌘Z took the newest toast carrying *any* action. Error toasts always carry
 *     [Try again], so after a failure ⌘Z re-ran the thing that just failed.
 *   - Nothing outside the Screener checked the modal layers, so `c` opened a
 *     composer behind an open dialog and `e` archived a row the user couldn't see.
 */
describe('§8.1 shortcut guards', () => {
  beforeEach(() => {
    localStorage.clear();
    MockMailProvider.reset();
    useMail.getState().setProvider(new MockMailProvider());
    useCompose.getState().close();
    useToasts.setState({ toasts: [] });
    useUi.setState({ heldSheetSenderId: null, dialog: null, shortcutsOpen: false });
  });

  afterEach(cleanup);

  describe('modifiers never trigger a single-key shortcut', () => {
    async function renderScreener() {
      await useMail.getState().loadHeld();
      render(
        <MemoryRouter initialEntries={['/screener']}>
          <Routes>
            <Route path="/screener" element={<ScreenerRoute />} />
            <Route path="/screener/s/:senderId" element={<ScreenerRoute />} />
          </Routes>
        </MemoryRouter>,
      );
      await screen.findByRole('button', { name: /Approve sender/ });
    }

    it('leaves the top sender alone on ⌘A', async () => {
      const user = userEvent.setup();
      await renderScreener();
      const before = useMail.getState().held.map((h) => h.sender.id);

      await user.keyboard('{Meta>}a{/Meta}');

      expect(useMail.getState().held.map((h) => h.sender.id)).toEqual(before);
      expect(useMail.getState().deciding).toBe(0);
    });

    it('leaves the top sender alone on Ctrl+D', async () => {
      const user = userEvent.setup();
      await renderScreener();
      const before = useMail.getState().held.map((h) => h.sender.id);

      await user.keyboard('{Control>}d{/Control}');

      expect(useMail.getState().held.map((h) => h.sender.id)).toEqual(before);
    });

    it('still decides on an unmodified a', async () => {
      const user = userEvent.setup();
      await renderScreener();
      const before = useMail.getState().held.length;

      await user.keyboard('a');

      await waitFor(() => expect(useMail.getState().held.length).toBe(before - 1));
    });
  });

  describe('⌘Z targets an undo, not a retry', () => {
    it('runs the newest undo toast', () => {
      const undo = vi.fn();
      toast.undo('Approved Dana.', 'Undo', undo);

      expect(useToasts.getState().undoNewest()).toBe(true);
      expect(undo).toHaveBeenCalledOnce();
    });

    it('will not re-run a failed action from an error toast', () => {
      const retry = vi.fn();
      toast.error("Couldn't approve Dana.", { label: 'Try again', run: retry });

      expect(useToasts.getState().undoNewest()).toBe(false);
      expect(retry).not.toHaveBeenCalled();
      // The toast stays put — errors never auto-dismiss (D9).
      expect(useToasts.getState().toasts).toHaveLength(1);
    });

    it('reaches past an error toast to the undo underneath it', () => {
      const undo = vi.fn();
      const retry = vi.fn();
      toast.undo('Archived 3 threads.', 'Undo', undo);
      toast.error("Couldn't reach Gmail.", { label: 'Try again', run: retry });

      expect(useToasts.getState().undoNewest()).toBe(true);
      expect(undo).toHaveBeenCalledOnce();
      expect(retry).not.toHaveBeenCalled();
    });
  });

  describe('a modal layer swallows single-key shortcuts', () => {
    function Harness() {
      useGlobalShortcuts({ current: null });
      return <div>harness</div>;
    }

    function renderHarness() {
      render(
        <MemoryRouter>
          <Harness />
        </MemoryRouter>,
      );
    }

    it('opens the composer on c with nothing in front', async () => {
      const user = userEvent.setup();
      renderHarness();

      await user.keyboard('c');
      expect(useCompose.getState().draft).not.toBeNull();
    });

    it('leaves c alone while the shortcuts dialog is open', async () => {
      const user = userEvent.setup();
      renderHarness();
      useUi.setState({ shortcutsOpen: true });

      await user.keyboard('c');
      expect(useCompose.getState().draft).toBeNull();
    });

    it('leaves c alone while a confirm dialog is open', async () => {
      const user = userEvent.setup();
      renderHarness();
      useUi.getState().openDialog({
        title: 'Sign out?',
        body: 'You can sign back in any time.',
        primaryLabel: 'Sign out',
        tone: 'destructive',
        onConfirm: () => {},
      });

      await user.keyboard('c');
      expect(useCompose.getState().draft).toBeNull();
    });

    it('leaves c alone while the held-message sheet is open', async () => {
      const user = userEvent.setup();
      renderHarness();
      useUi.setState({ heldSheetSenderId: 's-held-0' });

      await user.keyboard('c');
      expect(useCompose.getState().draft).toBeNull();
    });

    it('still closes the topmost layer on Esc', async () => {
      const user = userEvent.setup();
      renderHarness();
      useUi.setState({ shortcutsOpen: true });

      await user.keyboard('{Escape}');
      expect(useUi.getState().shortcutsOpen).toBe(false);
    });
  });

  describe('shortcutsBlocked', () => {
    const key = (init: Partial<KeyboardEventInit> = {}) =>
      new KeyboardEvent('keydown', { key: 'a', ...init });

    it('passes a bare key with nothing in front', () => {
      expect(shortcutsBlocked(key())).toBe(false);
    });

    it.each(['metaKey', 'ctrlKey', 'altKey'] as const)('blocks %s', (modifier) => {
      expect(shortcutsBlocked(key({ [modifier]: true }))).toBe(true);
    });

    it('does not block Shift, which §8.1 uses for range selection', () => {
      expect(shortcutsBlocked(key({ shiftKey: true }))).toBe(false);
    });

    it('blocks while any modal layer is open', () => {
      useUi.setState({ shortcutsOpen: true });
      expect(shortcutsBlocked(key())).toBe(true);
      useUi.setState({ shortcutsOpen: false, heldSheetSenderId: 's-1' });
      expect(shortcutsBlocked(key())).toBe(true);
    });

    it('blocks while focus is in a text field', () => {
      const input = document.createElement('input');
      document.body.append(input);
      const event = new KeyboardEvent('keydown', { key: 'a' });
      Object.defineProperty(event, 'target', { value: input });
      expect(shortcutsBlocked(event)).toBe(true);
      input.remove();
    });
  });
});
