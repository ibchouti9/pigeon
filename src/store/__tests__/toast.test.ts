import { beforeEach, describe, expect, it, vi } from 'vitest';
import { toast, useToasts } from '../toast';

describe('toasts', () => {
  beforeEach(() => {
    useToasts.setState({ toasts: [] });
  });

  it('uses 8 seconds for undo and 3 for a plain confirmation (D9)', () => {
    toast.confirm('Decision undone.');
    toast.undo('Archived.', 'Undo', () => {});

    const [undo, confirm] = useToasts.getState().toasts;
    expect(undo.duration).toBe(8000);
    expect(confirm.duration).toBe(3000);
  });

  it('never auto-dismisses an error (WCAG 2.2.1)', () => {
    toast.error('Search didn\'t run. Try again.');
    expect(useToasts.getState().toasts[0].duration).toBeNull();
  });

  it('shows at most 3, newest on top (§5.14)', () => {
    for (let i = 1; i <= 5; i++) toast.confirm(`Toast ${i}`);
    const toasts = useToasts.getState().toasts;
    expect(toasts).toHaveLength(3);
    expect(toasts[0].message).toBe('Toast 5');
    expect(toasts[2].message).toBe('Toast 3');
  });

  it('⌘Z runs the newest action and dismisses it', () => {
    const older = vi.fn();
    const newer = vi.fn();
    toast.undo('Older.', 'Undo', older);
    toast.undo('Newer.', 'Undo', newer);

    expect(useToasts.getState().undoNewest()).toBe(true);

    expect(newer).toHaveBeenCalledOnce();
    expect(older).not.toHaveBeenCalled();
    expect(useToasts.getState().toasts.map((t) => t.message)).not.toContain('Newer.');
  });

  it('⌘Z skips toasts with no action', () => {
    const run = vi.fn();
    toast.undo('Archived.', 'Undo', run);
    toast.confirm('Automatic summaries are off.');

    expect(useToasts.getState().undoNewest()).toBe(true);
    expect(run).toHaveBeenCalledOnce();
  });

  it('⌘Z reports nothing to undo when no toast carries an action', () => {
    toast.confirm('Back online.');
    expect(useToasts.getState().undoNewest()).toBe(false);
  });
});
