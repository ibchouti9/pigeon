import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { toast, useToasts } from '../../../store/toast';
import { ToastStack } from '../ToastStack';

/**
 * §8.4 — "Auto-dismiss timers pause on `mouseenter` and on `focusin` and
 * resume on leave." That is WCAG 2.2.1: an undo the user is reaching for must
 * not vanish under the cursor.
 *
 * Tested with fake timers because the browser cannot: the window is eight
 * seconds and driving it through a real pointer takes longer than that, which
 * is how a first attempt "showed" the pause failing when it had simply run out
 * of time. Testing Library dispatches the events React actually listens for,
 * which a hand-built `mouseenter` does not.
 */
describe('a toast the user is reaching for (§8.4)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useToasts.setState({ toasts: [] });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  /** D9's undo window. */
  const UNDO_MS = 8000;

  function pushUndo() {
    act(() => {
      toast.undo('Archived.', 'Undo', () => {});
    });
  }

  it('dismisses on its own after the undo window', () => {
    render(<ToastStack />);
    pushUndo();
    expect(screen.getByText('Archived.')).toBeInTheDocument();

    act(() => void vi.advanceTimersByTime(UNDO_MS + 500));

    expect(screen.queryByText('Archived.')).not.toBeInTheDocument();
  });

  it('stops the clock while the pointer is over it', () => {
    render(<ToastStack />);
    pushUndo();

    act(() => void vi.advanceTimersByTime(4000));
    fireEvent.mouseEnter(screen.getByText('Archived.').parentElement!);
    act(() => void vi.advanceTimersByTime(UNDO_MS * 3));

    expect(screen.getByText('Archived.')).toBeInTheDocument();
  });

  it('resumes when the pointer leaves, with the time it had left', () => {
    render(<ToastStack />);
    pushUndo();
    const item = screen.getByText('Archived.').parentElement!;

    act(() => void vi.advanceTimersByTime(4000));
    fireEvent.mouseEnter(item);
    act(() => void vi.advanceTimersByTime(60_000));
    fireEvent.mouseLeave(item);

    // Four of the eight seconds were spent before the pause, so it goes on the
    // remainder — not on a fresh eight.
    act(() => void vi.advanceTimersByTime(3000));
    expect(screen.getByText('Archived.')).toBeInTheDocument();

    act(() => void vi.advanceTimersByTime(2000));
    expect(screen.queryByText('Archived.')).not.toBeInTheDocument();
  });

  it('stops the clock while focus is inside it, for a keyboard user', () => {
    render(<ToastStack />);
    pushUndo();

    // §8.4 puts the undo in the tab order; reaching it must not start a race.
    fireEvent.focus(screen.getByRole('button', { name: 'Undo' }));
    act(() => void vi.advanceTimersByTime(UNDO_MS * 3));

    expect(screen.getByText('Archived.')).toBeInTheDocument();
  });
});
