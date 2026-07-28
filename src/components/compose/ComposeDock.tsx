import { useEffect, useRef, useState } from 'react';
import { useCompose } from '../../store/compose';
import { useUi } from '../../store/ui';
import { MailError } from '../../data/provider';
import { useMail } from '../../store/mail';
import { useOnline } from '../../hooks/useOnline';
import { isSingleColumn, useBreakpoint } from '../../hooks/useBreakpoint';
import { toast } from '../../store/toast';
import { textToHtml } from '../../data/mime';
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
/**
 * How far the dock steps left when the assistant is docked beside it.
 *
 * `--layout-agent-width` (420) plus `--space-6` (24), as a number: the value
 * is set inline, and an inline `calc()` over those two tokens was accepted by
 * the element and then silently not applied.
 */
const AGENT_INSET_PX = 444;

export function ComposeDock() {
  /*
   * Steps out from under the assistant, which is fixed to the same edge —
   * 372px of overlap at 1280px with both open. Not a stray layout nit: the
   * agent's own `draft` tool opens this composer, so asking it to write a
   * reply put the reply behind the panel that wrote it.
   *
   * Below the desktop breakpoint the panel takes the whole width and there is
   * nowhere to step aside to.
   */
  const agentOpen = useUi((s) => s.agentOpen);
  const roomToMove = useBreakpoint() === 'desktop';

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
  // §5.12's full-screen sheet starts below 880px — the narrow tablet and the
  // phone, which is every width where the dock has nothing to dock beside.
  const isSheet = isSingleColumn(useBreakpoint());
  const [sending, setSending] = useState(false);

  const [sendError, setSendError] = useState<string | null>(null);

  // The dock is mounted for the life of the shell and only returns null when
  // there is no draft, so its state outlives the draft that produced it. A
  // failed send used to put its red banner on the *next* composer the user
  // opened, about a message they had never tried to send.
  const errorFor = useRef<string | null>(null);
  if (draft && errorFor.current !== draft.id) {
    errorFor.current = draft.id;
    if (sendError) setSendError(null);
  }
  const [pulsing, setPulsing] = useState(false);
  const firstPulse = useRef(pulse);

  useEffect(() => {
    if (pulse === firstPulse.current) return;
    firstPulse.current = pulse;
    setPulsing(true);
    // §3.5 1a — "the existing dock is focused and pulses". Only the pulse
    // happened; focus stayed wherever it was, so pressing c twice drew
    // attention to a composer the keyboard still couldn't reach. `pulse` also
    // rides down to the Composer as its focus token.
    setMinimized(false);
    const timer = setTimeout(() => setPulsing(false), 400);
    return () => clearTimeout(timer);
  }, [pulse, setMinimized]);

  if (!draft) return null;

  const title = draft.subject || 'New message';

  async function send() {
    if (!draft) return;
    setSendError(null);
    setSending(true);
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
      close();
      await loadThreads('inbox');
      toast.undo(`Sent to ${displayName(snapshot.to[0])}.`, 'Undo', async () => {
        await provider.unsend(message.id);
        await loadThreads('inbox');
        useCompose.getState().open(snapshot);
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
    } finally {
      setSending(false);
    }
  }

  function discard() {
    const snapshot = draft ? { ...draft } : null;
    close();

    // Closing an untouched "New message" is not discarding a draft. Offering to
    // undo one made the ✕ on an empty composer produce a toast about work the
    // user had not done.
    const hasContent =
      snapshot &&
      (snapshot.to.length > 0 ||
        snapshot.cc.length > 0 ||
        snapshot.bcc.length > 0 ||
        snapshot.subject.trim() !== '' ||
        snapshot.body.trim() !== '' ||
        snapshot.attachments.length > 0);
    if (!hasContent) return;

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
      focusToken={pulse}
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

  /*
   * §5.12 — "below 880px the dock becomes a full-screen sheet with the same
   * internals and a 'Cancel'/'Send' header". The CSS went full-screen but the
   * header stayed the dock's: a truncated subject and three icon buttons whose
   * expand and minimize mean nothing when the sheet already fills the screen.
   */
  const sheetHeader = (
    <div className={styles.sheetHeader}>
      <Button variant="tertiary" size="sm" onClick={discard}>
        Cancel
      </Button>
      <span className={cn('t-base', 'truncate', styles.sheetTitle)}>{title}</span>
      <Button
        variant="primary"
        size="sm"
        loading={sending}
        disabled={!draft.to.length}
        onClick={() => void send()}
      >
        Send
      </Button>
    </div>
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
      style={agentOpen && roomToMove ? { right: AGENT_INSET_PX } : undefined}
    >
      {isSheet ? sheetHeader : titleBar}
      {composer}
    </div>
  );
}
