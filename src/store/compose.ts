import { create } from 'zustand';
import type { Address, Draft } from '../types';

type ComposeState = {
  /** D13 — one draft at a time. Opening a second compose focuses this one. */
  draft: Draft | null;
  minimized: boolean;
  expanded: boolean;
  /** Bumped when `open` is called while a draft already exists (§3.5 1a). */
  pulse: number;

  open: (seed?: Partial<Draft>) => void;
  update: (patch: Partial<Draft>) => void;
  setMinimized: (v: boolean) => void;
  setExpanded: (v: boolean) => void;
  close: () => void;
};

let counter = 0;

function emptyDraft(seed?: Partial<Draft>): Draft {
  return {
    id: `draft-${++counter}`,
    to: [],
    cc: [],
    bcc: [],
    subject: '',
    body: '',
    mode: 'new',
    attachments: [],
    aiState: 'none',
    ...seed,
  };
}

export const useCompose = create<ComposeState>((set, get) => ({
  draft: null,
  minimized: false,
  expanded: false,
  pulse: 0,

  open: (seed) => {
    if (get().draft) {
      set((s) => ({ minimized: false, pulse: s.pulse + 1 }));
      return;
    }
    set({ draft: emptyDraft(seed), minimized: false, expanded: false });
  },

  update: (patch) =>
    set((s) => (s.draft ? { draft: { ...s.draft, ...patch } } : s)),

  setMinimized: (minimized) => set({ minimized }),
  setExpanded: (expanded) => set({ expanded }),

  close: () => set({ draft: null, minimized: false, expanded: false }),
}));

/** A draft is send-ready when it has at least one recipient and no placeholder. */
export function sendBlockedReason(draft: Draft, online: boolean): string | null {
  if (!online) return "You're offline. Pigeon will send this when you're back.";
  if (draft.to.length === 0) return null;
  const placeholder = draft.body.match(/\[confirm:[^\]]*\]/i);
  if (placeholder) return `Replace ${placeholder[0]} before sending.`;
  return null;
}

/** D26 — every unresolved `[confirm: …]` blocks send. */
export function hasUnresolvedPlaceholder(body: string): boolean {
  return /\[confirm:[^\]]*\]/i.test(body);
}

export function isCompleteAddress(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

export function parseAddress(input: string): Address {
  const trimmed = input.trim();
  const match = trimmed.match(/^(.*?)\s*<([^>]+)>$/);
  if (match) return { name: match[1].trim(), email: match[2].trim() };
  return { name: '', email: trimmed };
}
