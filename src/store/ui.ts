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

  setShortcutsOpen: (v: boolean) => void;
  openDialog: (d: ConfirmDialog) => void;
  closeDialog: () => void;
  openHeldSheet: (senderId: string) => void;
  closeHeldSheet: () => void;
}

export const useUi = create<UiState>((set) => ({
  shortcutsOpen: false,
  dialog: null,
  heldSheetSenderId: null,

  setShortcutsOpen: (shortcutsOpen) => set({ shortcutsOpen }),
  openDialog: (dialog) => set({ dialog }),
  closeDialog: () => set({ dialog: null }),
  openHeldSheet: (heldSheetSenderId) => set({ heldSheetSenderId }),
  closeHeldSheet: () => set({ heldSheetSenderId: null }),
}));

/** True when focus is somewhere that should swallow single-key shortcuts. */
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
