import { useEffect, useRef, useState } from 'react';
import { useCompose } from '../../store/compose';
import { useMail } from '../../store/mail';
import { useOnline } from '../../hooks/useOnline';
import { toast } from '../../store/toast';
import { Button } from '../primitives/Button';
import { Icon } from '../primitives/Icon';
import { Composer } from './Composer';
import { cn } from '../../lib/cn';
import { displayName } from '../../lib/format';
import styles from './ComposeDock.module.css';

/**
 * §5.12 — one docked composer, bottom-right, over any route. Non-modal
 * (`role="dialog"` with no focus trap and no scrim) so the user can click
 * behind it (C-9).
 */
export function ComposeDock() {
  const draft = useCompose((s) => s.draft);
  const minimized = useCompose((s) => s.minimized);
  const expanded = useCompose((s) => s.expanded);
  const pulse = useCompose((s) => s.pulse);
  const update = useCompose((s) => s.update);
  const setMinimized = useCompose((s) => s.setMinimized);
  const setExpanded = useCompose((s) => s.setExpanded);
  const close = useCompose((s) => s.close);

  const contacts = useMail((s) => s.contacts);
  const account = useMail((s) => s.account);
  const provider = useMail((s) => s.provider);
  const loadThreads = useMail((s) => s.loadThreads);
  const online = useOnline();

  const [sendError, setSendError] = useState<string | null>(null);
  const [pulsing, setPulsing] = useState(false);
  const firstPulse = useRef(pulse);

  useEffect(() => {
    if (pulse === firstPulse.current) return;
    firstPulse.current = pulse;
    setPulsing(true);
    const timer = setTimeout(() => setPulsing(false), 400);
    return () => clearTimeout(timer);
  }, [pulse]);

  if (!draft) return null;

  const title = draft.subject || 'New message';

  async function send() {
    if (!draft) return;
    setSendError(null);
    try {
      const message = await provider.send({
        to: draft.to,
        cc: draft.cc,
        bcc: draft.bcc,
        subject: draft.subject,
        body: draft.body,
        threadId: draft.threadId,
        attachments: draft.attachments,
      });
      const snapshot = { ...draft };
      close();
      await loadThreads('inbox');
      toast.undo(`Sent to ${displayName(snapshot.to[0])}.`, 'Undo', async () => {
        await provider.unsend(message.id);
        await loadThreads('inbox');
        useCompose.getState().open(snapshot);
      });
    } catch {
      setSendError(
        "Gmail didn't accept this message. Check the recipient addresses and send again.",
      );
    }
  }

  function discard() {
    const snapshot = draft ? { ...draft } : null;
    close();
    toast.undo('Draft discarded.', 'Undo', () => {
      if (snapshot) useCompose.getState().open(snapshot);
    });
  }

  if (minimized) {
    return (
      <div className={styles.minimized}>
        <div className={styles.titleBar}>
          <button
            type="button"
            className={cn('t-base', 'truncate', styles.title)}
            onClick={() => setMinimized(false)}
          >
            {title}
          </button>
          <Button variant="icon" size="xs" aria-label="Close" onClick={discard}>
            <Icon name="close" size={16} />
          </Button>
        </div>
      </div>
    );
  }

  const composer = (
    <Composer
      variant="docked"
      draft={draft}
      onChange={update}
      onSend={send}
      onDiscard={discard}
      contacts={contacts}
      userName={account?.name ?? ''}
      online={online}
      sendError={sendError}
      onRetrySend={() => void send()}
    />
  );

  const titleBar = (
    <div className={styles.titleBar}>
      <span className={cn('t-base', 'truncate', styles.title)}>{title}</span>
      <Button
        variant="icon"
        size="xs"
        aria-label={expanded ? 'Minimize' : 'Expand'}
        onClick={() => setExpanded(!expanded)}
      >
        <Icon name={expanded ? 'minimize' : 'expand'} size={16} />
      </Button>
      {!expanded && (
        <Button variant="icon" size="xs" aria-label="Minimize" onClick={() => setMinimized(true)}>
          <Icon name="minus" size={16} />
        </Button>
      )}
      <Button variant="icon" size="xs" aria-label="Close" onClick={discard}>
        <Icon name="close" size={16} />
      </Button>
    </div>
  );

  if (expanded) {
    return (
      <div className={styles.expanded}>
        <div role="dialog" aria-label="New message" className={styles.expandedPanel}>
          {titleBar}
          <div className={styles.body}>{composer}</div>
        </div>
      </div>
    );
  }

  return (
    <div
      role="dialog"
      aria-label="New message"
      className={cn(styles.dock, pulsing && styles.pulse)}
    >
      {titleBar}
      {composer}
    </div>
  );
}
