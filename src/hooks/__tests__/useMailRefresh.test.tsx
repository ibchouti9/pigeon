import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { useMail } from '../../store/mail';
import { MockMailProvider } from '../../data/mock/mockProvider';
import { useMailRefresh } from '../useMailRefresh';

/*
 * The seam to the engine, stubbed.
 *
 * `isDesktop` starts false so every test above keeps the web build's minute;
 * the watcher block below flips it. Hoisted, because `vi.mock`'s factory runs
 * before the module body and cannot close over an ordinary `let`.
 */
const native = vi.hoisted(() => ({
  isDesktop: false,
  listeners: new Map<string, (payload: unknown) => void>(),
  unlisten: vi.fn(),
}));

vi.mock('../../lib/desktop', () => ({
  isDesktop: () => native.isDesktop,
  listen: (event: string, handler: (payload: unknown) => void) => {
    native.listeners.set(event, handler);
    return Promise.resolve(native.unlisten);
  },
  invoke: () => Promise.resolve(),
}));

/** `watch::INBOX_CHANGED` in `src-tauri/src/mail/watch.rs`. */
const INBOX_CHANGED = 'mail://inbox-changed';

function Host() {
  useMailRefresh();
  return null;
}

function setVisibility(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', {
    value: state,
    configurable: true,
  });
}

/**
 * The store's `refresh` is tested on its own; this is about whether anything
 * ever calls it. The bug it replaces was exactly that shape — a mount-time
 * fetch with no second caller — and the same class of defect has bitten this
 * codebase before ("Thread summaries were unreachable: the reader took the
 * props; nothing supplied them").
 */
describe('useMailRefresh', () => {
  beforeEach(() => {
    localStorage.clear();
    MockMailProvider.reset();
    useMail.getState().setProvider(new MockMailProvider());
    setVisibility('visible');
    native.isDesktop = false;
    native.listeners.clear();
    native.unlisten.mockClear();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    cleanup();
    // spyOn returns the *existing* spy when a property is already wrapped, so
    // without this every count below is the running total for the file.
    vi.restoreAllMocks();
  });

  it('re-reads the mailbox on a timer', async () => {
    const refresh = vi.spyOn(useMail.getState(), 'refresh').mockResolvedValue();
    render(<Host />);

    expect(refresh).not.toHaveBeenCalled();
    await act(async () => {
      vi.advanceTimersByTime(60_000);
    });

    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('re-reads when the window is focused again', async () => {
    const refresh = vi.spyOn(useMail.getState(), 'refresh').mockResolvedValue();
    render(<Host />);

    await act(async () => {
      window.dispatchEvent(new Event('focus'));
    });

    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('re-reads when the tab becomes visible', async () => {
    const refresh = vi.spyOn(useMail.getState(), 'refresh').mockResolvedValue();
    render(<Host />);

    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });

    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('does not spend a tick on a window nobody is looking at', async () => {
    const refresh = vi.spyOn(useMail.getState(), 'refresh').mockResolvedValue();
    render(<Host />);
    setVisibility('hidden');

    await act(async () => {
      vi.advanceTimersByTime(180_000);
    });

    expect(refresh).not.toHaveBeenCalled();
  });

  it('stops when the shell unmounts', async () => {
    const refresh = vi.spyOn(useMail.getState(), 'refresh').mockResolvedValue();
    const { unmount } = render(<Host />);
    unmount();

    await act(async () => {
      vi.advanceTimersByTime(180_000);
      window.dispatchEvent(new Event('focus'));
    });

    expect(refresh).not.toHaveBeenCalled();
  });

  /**
   * The wiring between the engine's IDLE connection and the list on screen. It
   * is a handful of lines and the whole point of the watcher: unsubscribed,
   * Gmail pushes and nothing happens.
   */
  describe('with the engine watching', () => {
    async function mountNative() {
      native.isDesktop = true;
      const rendered = render(<Host />);
      // The subscription is a promise; let it resolve before poking it.
      await act(async () => {
        await Promise.resolve();
      });
      return rendered;
    }

    it('re-reads when the engine says the inbox changed', async () => {
      const refresh = vi.spyOn(useMail.getState(), 'refresh').mockResolvedValue();
      await mountNative();

      const announce = native.listeners.get(INBOX_CHANGED);
      expect(announce).toBeDefined();

      await act(async () => {
        announce?.(null);
      });
      expect(refresh).toHaveBeenCalledTimes(1);
    });

    /*
     * The timer skips a hidden window, because polling a screen nobody is
     * reading is waste. This is not a poll: Gmail has already said something
     * changed, and the count it produces is what the badge and the
     * notification are built from — both of which exist for exactly the case
     * where the window is not the thing in front of you.
     */
    it('re-reads on the event even with the window hidden', async () => {
      const refresh = vi.spyOn(useMail.getState(), 'refresh').mockResolvedValue();
      await mountNative();
      setVisibility('hidden');

      await act(async () => {
        native.listeners.get(INBOX_CHANGED)?.(null);
      });
      expect(refresh).toHaveBeenCalledTimes(1);
    });

    /*
     * The poll becomes a safety net rather than the mechanism, so it slows
     * down. A native build still polling every minute would be spending
     * requests on an answer the socket already has.
     */
    it('slows the poll to five minutes', async () => {
      const refresh = vi.spyOn(useMail.getState(), 'refresh').mockResolvedValue();
      await mountNative();

      await act(async () => {
        vi.advanceTimersByTime(60_000);
      });
      expect(refresh).not.toHaveBeenCalled();

      await act(async () => {
        vi.advanceTimersByTime(4 * 60_000);
      });
      expect(refresh).toHaveBeenCalledTimes(1);
    });

    it('stops listening when the shell unmounts', async () => {
      const { unmount } = await mountNative();
      unmount();
      expect(native.unlisten).toHaveBeenCalledTimes(1);
    });
  });
});
