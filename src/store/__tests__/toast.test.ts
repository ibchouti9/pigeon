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

  it('keeps the newest first (§5.14)', () => {
    for (let i = 1; i <= 5; i++) toast.confirm(`Toast ${i}`);
    const toasts = useToasts.getState().toasts;
    expect(toasts[0].message).toBe('Toast 5');
    expect(toasts[4].message).toBe('Toast 1');
  });

  /**
   * §5.14 caps what is *visible* at three, and the store used to enforce that
   * by dropping the rest — taking their undo handlers with them. Five archived
   * threads pushed five toasts and two undos vanished before anyone could
   * reach them. The cap now lives in ToastStack's render.
   */
  it('does not drop an undo when a burst pushes past the visible three', () => {
    const undos = Array.from({ length: 5 }, () => vi.fn());
    undos.forEach((run, i) => toast.undo(`Archived ${i}.`, 'Undo', run));

    const toasts = useToasts.getState().toasts;
    expect(toasts).toHaveLength(5);
    expect(toasts.every((t) => t.action)).toBe(true);

    // The oldest is off screen but still undoable.
    toasts[4].action!.run();
    expect(undos[0]).toHaveBeenCalledOnce();
  });

  it('bounds what it retains, so errors cannot pile up forever', () => {
    for (let i = 0; i < 40; i++) toast.error(`Error ${i}.`);
    expect(useToasts.getState().toasts.length).toBeLessThanOrEqual(20);
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
