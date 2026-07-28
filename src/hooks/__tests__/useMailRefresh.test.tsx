import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { useMail } from '../../store/mail';
import { MockMailProvider } from '../../data/mock/mockProvider';
import { useMailRefresh } from '../useMailRefresh';

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
});
