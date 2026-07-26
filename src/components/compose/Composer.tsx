import { useEffect, useId, useRef, useState } from 'react';
import type { Address, Draft, Message, OutgoingAttachment } from '../../types';
import { Button } from '../primitives/Button';
import { Icon } from '../primitives/Icon';
import { Chip } from '../primitives/Controls';
import { RecipientField } from './RecipientField';
import { BodyEditor } from './BodyEditor';
import { useAssistant, useBehaviour } from '../../ai/useAssistant';
import { hasUnresolvedPlaceholder } from '../../store/compose';
import { cn } from '../../lib/cn';
import { displayName, formatBytes } from '../../lib/format';
import type { Tone } from '../../ai/types';
import styles from './Composer.module.css';

/** D20 — attach on compose up to 25 MB, counted across the whole message. */
const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

let attachmentCounter = 0;

function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      const result = String(reader.result);
      // Strip the `data:<mime>;base64,` prefix.
      resolve(result.slice(result.indexOf(',') + 1));
    };
    reader.readAsDataURL(file);
  });
}

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
  /** Start drafting with Pigeon as soon as the composer mounts (⌘J, §5.6). */
  draftOnMount?: boolean;
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
  draftOnMount,
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

  // §3.4 step 3 — opening a reply "focus moves into the body field". The
  // recipients are already filled in, so the field the user wants is the body;
  // without this, `r` opened the composer and left focus on the thread row,
  // and typing went nowhere.
  useEffect(() => {
    if (variant !== 'inline') return;
    bodyRef.current?.focus();
  }, [variant]);
  const fileRef = useRef<HTMLInputElement>(null);
  const [attachError, setAttachError] = useState<string | null>(null);
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

  async function addFiles(files: FileList | null) {
    if (!files?.length) return;
    setAttachError(null);

    const existing = draft.attachments.reduce((n, a) => n + a.size, 0);
    const added: OutgoingAttachment[] = [];
    let total = existing;

    for (const file of Array.from(files)) {
      total += file.size;
      if (total > MAX_ATTACHMENT_BYTES) {
        setAttachError(
          `Attachments are limited to ${formatBytes(MAX_ATTACHMENT_BYTES)}. ${file.name} doesn't fit.`,
        );
        break;
      }
      added.push({
        id: `attachment-${++attachmentCounter}`,
        filename: file.name,
        size: file.size,
        mimeType: file.type || 'application/octet-stream',
        data: await readAsBase64(file),
      });
    }

    if (added.length) onChange({ attachments: [...draft.attachments, ...added] });
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

  // ⌘J from a thread with no reply open lands here: the composer mounts and
  // immediately asks for a draft, so one keystroke does the whole thing.
  useEffect(() => {
    if (!draftOnMount || !connected || draft.aiState !== 'none' || draft.body) return;
    void generate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftOnMount, connected]);

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
        busy={generating}
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

      {draft.attachments.length > 0 && (
        <div className={styles.attachments}>
          {draft.attachments.map((file) => (
            <span key={file.id} className={cn('t-xs', styles.attachment)}>
              <Icon name="attach" size={16} />
              {file.filename}
              <span className={styles.attachmentSize}>· {formatBytes(file.size)}</span>
              <button
                type="button"
                className={styles.attachmentRemove}
                aria-label={`Remove ${file.filename}`}
                onClick={() =>
                  onChange({ attachments: draft.attachments.filter((a) => a.id !== file.id) })
                }
              >
                <Icon name="close" size={16} />
              </button>
            </span>
          ))}
        </div>
      )}

      {attachError && (
        <div className={cn('t-sm', styles.errorBlock)} role="alert">
          {attachError}
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

        {/*
          display:none, not .visually-hidden — the clip technique leaves the
          input focusable and in the accessibility tree, which would put a
          second, silent "Attach file" stop next to the button that labels it.
          .click() still opens the picker on a display:none input.
        */}
        <input
          ref={fileRef}
          type="file"
          multiple
          className={styles.fileInput}
          onChange={(e) => {
            void addFiles(e.currentTarget.files);
            e.currentTarget.value = '';
          }}
        />
        <Button
          variant="icon"
          size="sm"
          aria-label="Attach file"
          title="Attach file"
          disabled={sending}
          onClick={() => fileRef.current?.click()}
        >
          <Icon name="attach" size={16} />
        </Button>

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
