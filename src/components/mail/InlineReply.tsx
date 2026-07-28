import { useEffect, useState } from 'react';
import type { Draft, Thread } from '../../types';
import { Composer } from '../compose/Composer';
import { MailError } from '../../data/provider';
import { useMail } from '../../store/mail';
import { useUi } from '../../store/ui';
import { useOnline } from '../../hooks/useOnline';
import { toast } from '../../store/toast';
import { textToHtml } from '../../data/mime';
import { displayName } from '../../lib/format';
import type { ReplyMode } from './ThreadReader';
import { buildReplyDraft } from './replyDraft';

export interface InlineReplyProps {
  thread: Thread;
  mode: ReplyMode;
  /** ⌘J opened this reply, so start drafting as soon as it mounts (§5.6). */
  draftOnOpen?: boolean;
  /** A draft handed back by an undo, rather than a fresh reply (§3.4 step 6). */
  initialDraft?: Draft;
  /** Asks the parent to reopen this composer holding the un-sent draft. */
  onRestore?: (draft: Draft) => void;
  onClose: () => void;
}

/**
 * D14 — the reply composer expands at the foot of the thread rather than in the
 * dock, so the quoted context stays visible while writing.
 */
export function InlineReply({
  thread,
  mode,
  draftOnOpen,
  initialDraft,
  onRestore,
  onClose,
}: InlineReplyProps) {
  const account = useMail((s) => s.account);
  const contacts = useMail((s) => s.contacts);
  const provider = useMail((s) => s.provider);
  const loadThreads = useMail((s) => s.loadThreads);
  const online = useOnline();

  const [draft, setDraft] = useState<Draft>(
    () => initialDraft ?? buildReplyDraft(thread, mode, account?.email ?? ''),
  );
  const [sendError, setSendError] = useState<string | null>(null);

  async function send() {
    setSendError(null);
    try {
      const message = await provider.send({
        to: draft.to,
        cc: draft.cc,
        bcc: draft.bcc,
        subject: draft.subject,
        body: draft.body,
        /*
         * The HTML half, built from the text the composer holds.
         *
         * The editor is still a textarea, so there is no formatting to carry
         * — but paragraphs are structure, and a recipient's client renders
         * `text/plain` as one undifferentiated block in a proportional font.
         * The text half goes out unchanged beside it (see `buildRawMessage`),
         * so nothing is lost for a client that prefers it.
         */
        bodyHtml: textToHtml(draft.body),
        threadId: draft.threadId,
        attachments: draft.attachments,
      });
      const snapshot = { ...draft };
      onClose();
      await loadThreads(thread.place);

      // §3.4 step 6 — "Undo restores the composer with the full draft and
      // un-appends the message". The docked composer reopens its snapshot; this
      // one used to un-send and throw away everything the user had written.
      toast.undo(`Sent to ${displayName(snapshot.to[0])}.`, 'Undo', async () => {
        await provider.unsend(message.id);
        await loadThreads(thread.place);
        onRestore?.(snapshot);
      });
    } catch (error) {
      // The provider already picks the right §7.6 line — a revoked token, an
      // unreachable Gmail and a rejected message each have their own. Hardcoding
      // one of them here told a user whose token had expired to check recipient
      // addresses that were perfectly good.
      setSendError(
        error instanceof MailError
          ? error.message
          : "Gmail didn't accept this message. Check the recipient addresses and send again.",
      );
    }
  }

  // §5.6 — "Esc collapses the composer if open and empty". Only when empty:
  // closing over typed text would lose it, and there is no minimized state
  // here to fall back to the way the dock has.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Escape') return;
      if (e.defaultPrevented) return;
      if (draft.body.trim() || draft.attachments.length) return;
      const ui = useUi.getState();
      if (ui.dialog || ui.shortcutsOpen || ui.heldSheetSenderId) return;
      onClose();
      e.stopPropagation();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [draft.body, draft.attachments.length, onClose]);

  return (
    <Composer
      variant="inline"
      draftOnMount={draftOnOpen}
      draft={draft}
      onChange={(patch) => setDraft((d) => ({ ...d, ...patch }))}
      onSend={send}
      onDiscard={onClose}
      contacts={contacts}
      threadMessages={thread.messages}
      userName={account?.name ?? ''}
      online={online}
      sendError={sendError}
      onRetrySend={() => void send()}
    />
  );
}
