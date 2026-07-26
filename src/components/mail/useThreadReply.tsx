import { useEffect, useState } from 'react';
import type { Draft, Thread } from '../../types';
import { InlineReply } from './InlineReply';
import type { ReplyMode } from './ThreadReader';

/**
 * D14's inline reply, as one piece both readers can hold.
 *
 * The Inbox and Archive had it and Search did not, so a result opened from
 * Search rendered §5.6's Reply, Reply all and Forward buttons — plus the
 * "Reply to {name}" affordance and `r`/`a`/`f` — with nothing behind any of
 * them. Every one silently did nothing.
 *
 * The state is three flags and a slot, which is small enough to have been
 * copied and large enough that the copies would have drifted, so it lives here
 * instead.
 */
export interface ThreadReply {
  /** The open reply's mode, or null when the composer is closed. */
  mode: ReplyMode | null;
  /** §5.6 — `r`/`a`/`f` and the three header buttons. */
  open: (mode: ReplyMode) => void;
  /** §5.6 — ⌘J opens the composer already drafting. */
  openDrafting: (mode: ReplyMode) => void;
  close: () => void;
  /** Passed to ThreadReader's `replySlot`; undefined when nothing is open. */
  slot: React.ReactNode;
}

export function useThreadReply(thread: Thread | undefined, online: boolean): ThreadReply {
  const [mode, setMode] = useState<ReplyMode | null>(null);
  /** Set by an undo, so the reopened composer holds what the user wrote. */
  const [restoredDraft, setRestoredDraft] = useState<Draft | null>(null);
  // Set when ⌘J opened the reply, so the composer starts drafting on mount.
  const [draftWithPigeon, setDraftWithPigeon] = useState(false);

  /*
   * A reply belongs to the thread it was opened on. Nothing cleared it when
   * the reader moved, so opening a reply on one thread and then opening
   * another showed a composer nobody asked for on the second — and if the
   * first had been opened with ⌘J, `draftWithPigeon` was still set, so the
   * new one immediately asked Pigeon for a draft of a thread the user had
   * only just arrived at.
   *
   * Keyed on the thread, so an undo reopening the composer on the *same*
   * thread (§3.4 step 6) is untouched.
   */
  const threadId = thread?.id;
  useEffect(() => {
    setMode(null);
    setRestoredDraft(null);
    setDraftWithPigeon(false);
  }, [threadId]);

  function open(next: ReplyMode) {
    // D21 — offline is read-only, so there is nothing to open into.
    if (!thread || !online) return;
    setDraftWithPigeon(false);
    setMode(next);
  }

  function openDrafting(next: ReplyMode) {
    if (!thread || !online) return;
    setDraftWithPigeon(true);
    setMode(next);
  }

  function close() {
    setMode(null);
    setDraftWithPigeon(false);
    setRestoredDraft(null);
  }

  return {
    mode,
    open,
    openDrafting,
    close,
    slot:
      thread && mode ? (
        <InlineReply
          // Remounts on a new thread, a new mode, or a restored draft, so the
          // composer never carries the previous reply's contents.
          key={`${thread.id}-${mode}-${restoredDraft?.id ?? ''}`}
          thread={thread}
          mode={mode}
          draftOnOpen={draftWithPigeon}
          initialDraft={restoredDraft ?? undefined}
          onRestore={(draft) => {
            setRestoredDraft(draft);
            setMode(draft.mode === 'forward' ? 'forward' : 'reply');
          }}
          onClose={close}
        />
      ) : undefined,
  };
}
