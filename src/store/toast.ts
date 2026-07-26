import { create } from 'zustand';

export interface Toast {
  id: string;
  message: string;
  tone: 'confirm' | 'error';
  action?: { label: string; run: () => void | Promise<void> };
  /**
   * Whether `action` undoes something. §8.1 binds ⌘Z to "the newest available
   * action (activates the top toast's undo)" — an error toast's [Try again]
   * carries an action too, and re-running the thing that just failed is the
   * opposite of an undo.
   */
  undoable?: boolean;
  /** ms. D9 — 8s for undo, 3s for plain confirmations, never for errors. */
  duration: number | null;
}

interface ToastState {
  toasts: Toast[];
  push: (t: Omit<Toast, 'id'>) => string;
  dismiss: (id: string) => void;
  /** ⌘Z — activates the newest toast that carries an action (§8.1). */
  undoNewest: () => boolean;
}

let counter = 0;

/** §5.14 — max 3 visible, newest on top. `ToastStack` does the slicing. */
export const MAX_VISIBLE = 3;

/**
 * A ceiling on what's kept, well above what's ever on screen. The store used to
 * hold only the visible three: archiving five selected threads pushed five
 * toasts, and the two oldest were dropped from state — with their undo
 * handlers. The user saw three Undos and had silently lost two.
 */
const MAX_RETAINED = 20;

export const useToasts = create<ToastState>((set, get) => ({
  toasts: [],

  push: (t) => {
    const id = `toast-${++counter}`;
    set((s) => ({ toasts: [{ ...t, id }, ...s.toasts].slice(0, MAX_RETAINED) }));
    return id;
  },

  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

  undoNewest: () => {
    const newest = get().toasts.find((t) => t.action && t.undoable);
    if (!newest?.action) return false;
    get().dismiss(newest.id);
    void newest.action.run();
    return true;
  },
}));

/** Shorthands that keep the durations from D9 in one place. */
export const toast = {
  confirm(message: string) {
    useToasts.getState().push({ message, tone: 'confirm', duration: 3000 });
  },
  undo(message: string, label: string, run: () => void | Promise<void>) {
    useToasts.getState().push({
      message,
      tone: 'confirm',
      duration: 8000,
      action: { label, run },
      undoable: true,
    });
  },
  error(message: string, action?: { label: string; run: () => void | Promise<void> }) {
    useToasts.getState().push({ message, tone: 'error', duration: null, action });
  },
};
