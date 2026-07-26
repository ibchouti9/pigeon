import { useState } from 'react';
import type { Draft, Thread } from '../../types';
import { Composer } from '../compose/Composer';
import { useMail } from '../../store/mail';
import { useOnline } from '../../hooks/useOnline';
import { toast } from '../../store/toast';
import { displayName } from '../../lib/format';
import type { ReplyMode } from './ThreadReader';
import { buildReplyDraft } from './replyDraft';

export interface InlineReplyProps {
  thread: Thread;
  mode: ReplyMode;
  onClose: () => void;
}

/**
 * D14 — the reply composer expands at the foot of the thread rather than in the
 * dock, so the quoted context stays visible while writing.
 */
export function InlineReply({ thread, mode, onClose }: InlineReplyProps) {
  const account = useMail((s) => s.account);
  const contacts = useMail((s) => s.contacts);
  const provider = useMail((s) => s.provider);
  const loadThreads = useMail((s) => s.loadThreads);
  const online = useOnline();

  const [draft, setDraft] = useState<Draft>(() =>
    buildReplyDraft(thread, mode, account?.email ?? ''),
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
        threadId: draft.threadId,
      });
      const snapshot = { ...draft };
      onClose();
      await loadThreads(thread.place);

      toast.undo(`Sent to ${displayName(snapshot.to[0])}.`, 'Undo', async () => {
        await provider.unsend(message.id);
        await loadThreads(thread.place);
      });
    } catch {
      setSendError(
        "Gmail didn't accept this message. Check the recipient addresses and send again.",
      );
    }
  }

  return (
    <Composer
      variant="inline"
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
