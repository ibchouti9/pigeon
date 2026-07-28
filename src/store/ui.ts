import { create } from 'zustand';

export interface ConfirmDialog {
  title: string;
  body: string;
  /** D11 — exactly two actions use a dialog: Sign out and Disconnect. */
  primaryLabel: string;
  tone: 'neutral' | 'destructive';
  onConfirm: () => void;
}

interface UiState {
  shortcutsOpen: boolean;
  dialog: ConfirmDialog | null;
  /** Sender id whose held message is showing in a sheet over the Screener. */
  heldSheetSenderId: string | null;
  /** Whether the agent panel is docked open. */
  agentOpen: boolean;

  setShortcutsOpen: (v: boolean) => void;
  setAgentOpen: (v: boolean) => void;
  openDialog: (d: ConfirmDialog) => void;
  closeDialog: () => void;
  openHeldSheet: (senderId: string) => void;
  closeHeldSheet: () => void;
}

export const useUi = create<UiState>((set) => ({
  shortcutsOpen: false,
  agentOpen: false,
  dialog: null,
  heldSheetSenderId: null,

  setShortcutsOpen: (shortcutsOpen) => set({ shortcutsOpen }),
  setAgentOpen: (agentOpen) => set({ agentOpen }),
  openDialog: (dialog) => set({ dialog }),
  closeDialog: () => set({ dialog: null }),
  openHeldSheet: (heldSheetSenderId) => set({ heldSheetSenderId }),
  closeHeldSheet: () => set({ heldSheetSenderId: null }),
}));

/** True when focus is somewhere that should swallow single-key shortcuts. */
/**
 * §8.1 — "Shortcuts are single keys with no modifier except where noted, and
 * are disabled while focus is inside a text field". A modal layer swallows them
 * as well: with the shortcuts dialog, a confirm dialog, or the held-message
 * sheet open, `c` must not open a composer behind it and `e` must not archive
 * a row the user can't see.
 *
 * Every unmodified single-key handler goes through this. Handlers that own a
 * modified shortcut (Esc, ⌘Enter, ⌘J, ⌘Z) test for it before calling.
 */
export function shortcutsBlocked(e: KeyboardEvent): boolean {
  if (isTypingTarget(e.target)) return true;
  if (e.metaKey || e.ctrlKey || e.altKey) return true;
  const ui = useUi.getState();
  return Boolean(ui.dialog || ui.shortcutsOpen || ui.heldSheetSenderId);
}

export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    target.isContentEditable
  );
}
