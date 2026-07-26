import { useId, useRef, useState } from 'react';
import type { Address, Draft, Message } from '../../types';
import { Button } from '../primitives/Button';
import { Icon } from '../primitives/Icon';
import { Chip } from '../primitives/Controls';
import { RecipientField } from './RecipientField';
import { BodyEditor } from './BodyEditor';
import { useAssistant, useBehaviour } from '../../ai/useAssistant';
import { hasUnresolvedPlaceholder } from '../../store/compose';
import { cn } from '../../lib/cn';
import { displayName } from '../../lib/format';
import type { Tone } from '../../ai/types';
import styles from './Composer.module.css';

const TONES: { value: Tone; label: string }[] = [
  { value: 'shorter', label: 'Shorter' },
  { value: 'friendlier', label: 'Friendlier' },
  { value: 'firmer', label: 'Firmer' },
];

export interface ComposerProps {
  draft: Draft;
  onChange: (patch: Partial<Draft>) => void;
  onSend: () => void | Promise<void>;
  onDiscard: () => void;
  contacts: Address[];
  /** Thread context for "Draft with Pigeon". */
  threadMessages?: Message[];
  userName: string;
  online: boolean;
  /** Docked composers carry a title bar and a scrim-free dialog role. */
  variant: 'inline' | 'docked';
  className?: string;
  /** Rendered above the action bar when a send fails (§3.4 6a). */
  sendError?: string | null;
  onRetrySend?: () => void;
}

export function Composer({
  draft,
  onChange,
  onSend,
  onDiscard,
  contacts,
  threadMessages = [],
  userName,
  online,
  variant,
  className,
  sendError,
  onRetrySend,
}: ComposerProps) {
  const { client, connected } = useAssistant();
  const behaviour = useBehaviour();
  const [showCcBcc, setShowCcBcc] = useState(
    draft.cc.length > 0 || draft.bcc.length > 0,
  );
  const [sending, setSending] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [tonePending, setTonePending] = useState<Tone | null>(null);
  const [toneDone, setToneDone] = useState<Tone | null>(null);
  const [undoBody, setUndoBody] = useState<string | null>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const provenanceId = useId();

  const generating = draft.aiState === 'generating';
  const isAiInk = draft.aiState === 'drafted';
  const showProvenance = draft.aiState === 'drafted' || draft.aiState === 'edited';
  const placeholderBlocked = hasUnresolvedPlaceholder(draft.body);
  const placeholderText = draft.body.match(/\[confirm:[^\]]*\]/i)?.[0];

  const blockedReason = !online
    ? "You're offline. Pigeon will send this when you're back."
    : placeholderBlocked
      ? `Replace ${placeholderText} before sending.`
      : null;

  const invalidRecipient = draft.to.find(
    (a) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(a.email),
  );
  const sendDisabled =
    sending || draft.to.length === 0 || placeholderBlocked || !online || Boolean(invalidRecipient);

  async function send() {
    if (sendDisabled) return;
    setSending(true);
    try {
      await onSend();
    } finally {
      setSending(false);
    }
  }

  async function generate() {
    if (!client) return;
    setDraftError(null);
    onChange({ aiState: 'generating' });
    try {
      const body = await client.draftReply({
        messages: threadMessages,
        subject: draft.subject,
        recipients: draft.to.map((a) => a.email),
        userName,
        styleSamples: behaviour.matchWritingStyle
          ? threadMessages.filter((m) => m.isFromUser).map((m) => m.body)
          : undefined,
      });
      onChange({ body, aiState: 'drafted' });
    } catch {
      onChange({ aiState: draft.body ? 'edited' : 'none' });
      setDraftError("Pigeon couldn't write a draft. Write your reply, or try again.");
    }
  }

  async function applyTone(tone: Tone) {
    if (!client) return;
    setTonePending(tone);
    const previous = draft.body;
    try {
      const body = await client.retone(draft.body, tone);
      setUndoBody(previous);
      onChange({ body });
      setToneDone(tone);
      setTimeout(() => setToneDone(null), 1200);
    } catch {
      setDraftError("Pigeon couldn't write a draft. Write your reply, or try again.");
    } finally {
      setTonePending(null);
    }
  }

  function onBodyChange(next: string) {
    // §4.7 — editing any character claims authorship.
    const aiState = draft.aiState === 'drafted' ? 'edited' : draft.aiState;
    onChange({ body: next, aiState });
  }

  function onBodyKeyDown(e: React.KeyboardEvent) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      void send();
      e.preventDefault();
    } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'j') {
      if (connected) void generate();
      e.preventDefault();
    }
  }

  const recipientLabel = draft.to.length
    ? displayName(draft.to[0])
    : draft.mode === 'new'
      ? 'New message'
      : 'this thread';

  return (
    <form
      className={cn(styles.composer, variant === 'inline' && styles.inline, className)}
      aria-label={draft.mode === 'new' ? 'New message' : `Reply to ${recipientLabel}`}
      onSubmit={(e) => {
        e.preventDefault();
        void send();
      }}
    >
      <div className={styles.fields}>
        <RecipientField
          label="To"
          value={draft.to}
          onChange={(to) => onChange({ to })}
          contacts={contacts}
          placeholder="Recipients"
          disabled={sending}
          autoFocus={variant === 'docked' && draft.to.length === 0}
          trailing={
            !showCcBcc && (
              <Button variant="tertiary" size="sm" onClick={() => setShowCcBcc(true)}>
                Cc Bcc
              </Button>
            )
          }
        />

        {showCcBcc && (
          <>
            <RecipientField
              label="Cc"
              value={draft.cc}
              onChange={(cc) => onChange({ cc })}
              contacts={contacts}
              disabled={sending}
            />
            <RecipientField
              label="Bcc"
              value={draft.bcc}
              onChange={(bcc) => onChange({ bcc })}
              contacts={contacts}
              disabled={sending}
            />
          </>
        )}

        <div className={styles.subjectRow}>
          <label className={cn('t-sm', styles.subjectLabel)} htmlFor={`${provenanceId}-subject`}>
            Subject
          </label>
          <input
            id={`${provenanceId}-subject`}
            className={cn('t-base', styles.subjectInput)}
            value={draft.subject}
            disabled={sending}
            onChange={(e) => onChange({ subject: e.currentTarget.value })}
          />
        </div>
      </div>

      <BodyEditor
        className={styles.body}
        value={draft.body}
        onChange={onBodyChange}
        drafted={isAiInk}
        disabled={sending || generating}
        ariaLabel="Message body"
        ariaDescribedBy={showProvenance ? provenanceId : undefined}
        textareaRef={bodyRef}
        onKeyDown={onBodyKeyDown}
        minHeight={variant === 'inline' ? 160 : 200}
      />

      {showProvenance && (
        <div className={styles.provenance} id={provenanceId}>
          <span className={cn('t-mono-sm', styles.provenanceLabel)}>
            ◆ Drafted by Pigeon
            {draft.aiState === 'edited' ? ' · edited by you' : ''}
          </span>
          {TONES.map((tone) => (
            <Chip
              key={tone.value}
              kind="tone"
              label={toneDone === tone.value ? `${tone.label} ✓` : tone.label}
              disabled={tonePending !== null || !connected}
              onClick={() => void applyTone(tone.value)}
            />
          ))}
          {undoBody !== null && (
            <Button
              variant="tertiary"
              size="sm"
              onClick={() => {
                onChange({ body: undoBody });
                setUndoBody(null);
              }}
            >
              Undo
            </Button>
          )}
          <span className={styles.provenanceSpacer} />
          <Button
            variant="tertiary"
            size="sm"
            onClick={() => onChange({ body: '', aiState: 'none' })}
          >
            Discard draft
          </Button>
        </div>
      )}

      {draftError && (
        <div className={cn('t-sm', styles.errorBlock)} role="alert">
          {draftError}
          <div className={styles.errorActions}>
            <Button variant="tertiary" size="sm" onClick={() => void generate()}>
              Try again
            </Button>
          </div>
        </div>
      )}

      {sendError && (
        <div className={cn('t-sm', styles.errorBlock)} role="alert">
          {sendError}
          <div className={styles.errorActions}>
            <Button variant="tertiary" size="sm" onClick={onRetrySend}>
              Send again
            </Button>
          </div>
        </div>
      )}

      <div className={styles.actions}>
        <Button variant="primary" type="submit" loading={sending} disabled={sendDisabled}>
          Send
        </Button>

        <Button
          variant="secondary"
          loading={generating}
          disabled={!connected || sending}
          iconLeading={<Icon name="pen" size={16} />}
          onClick={() => void generate()}
          title={connected ? undefined : 'Connect a provider in Settings → Assistant'}
        >
          Draft with Pigeon
        </Button>

        {!connected && (
          <span className={cn('t-xs', styles.helper)}>Connect a provider to draft replies.</span>
        )}
        {connected && blockedReason && (
          <span className={cn('t-xs', styles.helper, placeholderBlocked && styles.helperBlocked)}>
            {blockedReason}
          </span>
        )}
        {connected && !blockedReason && invalidRecipient && (
          <span className={cn('t-xs', styles.helper, styles.helperBlocked)}>
            {invalidRecipient.email} isn't a complete address.
          </span>
        )}

        <span className={styles.actionsSpacer} />

        <Button
          variant="icon"
          size="sm"
          aria-label="Discard"
          title="Discard"
          onClick={onDiscard}
        >
          <Icon name="trash" size={16} />
        </Button>
      </div>
    </form>
  );
}
