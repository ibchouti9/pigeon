import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Address, Draft } from '../types';

type ComposeState = {
  /** D13 — one draft at a time. Opening a second compose focuses this one. */
  draft: Draft | null;
  minimized: boolean;
  expanded: boolean;
  /** Bumped when `open` is called while a draft already exists (§3.5 1a). */
  pulse: number;
  /**
   * How many attachments a restored draft came back without.
   *
   * Files are the one part of a draft not persisted, and dropping them
   * silently would be worse than losing them: the user would send a message
   * they believe has a file on it. Zero for a draft that was never restored.
   */
  droppedAttachments: number;

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

/** Whether anything has been typed that would be a loss to throw away. */
function isWorthKeeping(draft: Draft | null): boolean {
  if (!draft) return false;
  return Boolean(
    draft.body.trim() ||
      draft.subject.trim() ||
      draft.to.length ||
      draft.cc.length ||
      draft.bcc.length,
  );
}

export const useCompose = create<ComposeState>()(
  persist(
    (set, get) => ({
      draft: null,
      minimized: false,
      expanded: false,
      pulse: 0,
      droppedAttachments: 0,

      open: (seed) => {
        if (get().draft) {
          set((s) => ({ minimized: false, pulse: s.pulse + 1 }));
          return;
        }
        set({
          draft: emptyDraft(seed),
          minimized: false,
          expanded: false,
          droppedAttachments: 0,
        });
      },

      update: (patch) => set((s) => (s.draft ? { draft: { ...s.draft, ...patch } } : s)),

      setMinimized: (minimized) => set({ minimized }),
      setExpanded: (expanded) => set({ expanded }),

      close: () =>
        set({ draft: null, minimized: false, expanded: false, droppedAttachments: 0 }),
    }),
    {
      name: 'pigeon.draft',
      /*
       * §3.5 3e says the offline banner "warns that closing the tab loses it",
       * and §7 gives that banner one sentence which cannot be added to. The
       * other way to make the sentence unnecessary is to stop losing the
       * draft, which is this.
       *
       * Attachments are deliberately not persisted: they are base64 in the
       * draft and the composer accepts 25 MB, which no localStorage will take
       * — and a quota failure would lose the *whole* draft rather than the
       * files. A file can be picked from disk again; typed prose cannot be
       * retyped, so the bytes worth keeping are the ones that are cheap.
       */
      partialize: (s) => ({
        draft: isWorthKeeping(s.draft)
          ? { ...s.draft!, attachments: [], aiState: 'none' as const }
          : null,
        minimized: s.minimized,
        expanded: s.expanded,
        droppedAttachments: s.draft?.attachments.length ?? 0,
      }),
    },
  ),
);

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
