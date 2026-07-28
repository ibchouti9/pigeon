import { useEffect, useId, useRef, useState } from 'react';
import type { Address, Draft, Message, OutgoingAttachment } from '../../types';
import { Button } from '../primitives/Button';
import { Icon } from '../primitives/Icon';
import { Chip } from '../primitives/Controls';
import { Tooltip } from '../primitives/Feedback';
import { RecipientField } from './RecipientField';
import { BodyEditor } from './BodyEditor';
import { useAssistant, useBehaviour } from '../../ai/useAssistant';
import { hasUnresolvedPlaceholder, useCompose } from '../../store/compose';
import { cn } from '../../lib/cn';
import { displayName, formatBytes, plural } from '../../lib/format';
import type { Tone } from '../../ai/types';
import styles from './Composer.module.css';

/** D20 — attach on compose up to 25 MB, counted across the whole message. */
const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

/** `--duration-base` — how long the inline composer takes to expand open. */
const EXPAND_MS = 180;

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
  /**
   * Bump to pull focus into the body. §3.5 1a's second compose focuses the
   * open dock; a boolean would only fire once.
   */
  focusToken?: number;
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
  /**
   * The composer is the whole screen (§5.12's sheet, below 880px), so the body
   * fills the height rather than growing to fit its own text.
   */
  fill?: boolean;
  className?: string;
  /** Start drafting with Pigeon as soon as the composer mounts (⌘J, §5.6). */
  draftOnMount?: boolean;
  /** Rendered above the action bar when a send fails (§3.4 6a). */
  sendError?: string | null;
  onRetrySend?: () => void;
}

export function Composer({
  focusToken,
  draft,
  onChange,
  onSend,
  onDiscard,
  contacts,
  threadMessages = [],
  userName,
  online,
  variant,
  fill,
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
  /*
   * Which action the error's "Try again" should repeat. §7.6 gives one line
   * for both — "Pigeon couldn't write a draft." — and it used to always retry
   * a whole fresh draft. So a failed *tone change* offered a button that threw
   * away everything the user had written and replaced it with a new
   * generation, which is the one thing the error must not do.
   */
  const [failedTone, setFailedTone] = useState<Tone | null>(null);
  const [tonePending, setTonePending] = useState<Tone | null>(null);
  const [toneDone, setToneDone] = useState<Tone | null>(null);
  const [undoBody, setUndoBody] = useState<string | null>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  // §3.4 step 3 — opening a reply "focus moves into the body field". The
  // recipients are already filled in, so the field the user wants is the body;
  // without this, `r` opened the composer and left focus on the thread row,
  // and typing went nowhere.
  useEffect(() => {
    // A docked composer that arrives with its recipient already filled in —
    // "Send yourself a test" (§5.5), or a forward — wants the body too. Only
    // an empty To field is worth focusing, and that one is handled by the
    // field's own autoFocus.
    if (variant !== 'inline' && draft.to.length === 0) return;
    bodyRef.current?.focus();

    /*
     * §3.4 step 3 puts the composer "at the foot of the thread", which on a long
     * one is below the fold. focus() alone left it there, and so did scrolling
     * on the next frame: the composer animates its height open, so for most of
     * that it is a 44px sliver with nothing worth scrolling to. Scroll when the
     * expansion actually ends, with a timer as the fallback for the reduced-
     * motion case where the animation may not fire at all.
     */
    const reveal = () => bodyRef.current?.scrollIntoView({ block: 'nearest' });
    const form = formRef.current;
    form?.addEventListener('animationend', reveal, { once: true });
    const timer = setTimeout(reveal, EXPAND_MS * 2);
    return () => {
      form?.removeEventListener('animationend', reveal);
      clearTimeout(timer);
    };
    // Mount only: refocusing on every keystroke would fight the user.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [variant]);

  useEffect(() => {
    if (!focusToken) return;
    bodyRef.current?.focus();
  }, [focusToken]);
  const fileRef = useRef<HTMLInputElement>(null);
  const [attachError, setAttachError] = useState<string | null>(null);
  const provenanceId = useId();
  const droppedAttachments = useCompose((s) => s.droppedAttachments);

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
    setFailedTone(null);
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
    setDraftError(null);
    const previous = draft.body;
    try {
      const body = await client.retone(draft.body, tone);
      setUndoBody(previous);
      onChange({ body });
      setToneDone(tone);
      setTimeout(() => setToneDone(null), 1200);
    } catch {
      setFailedTone(tone);
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

  /*
   * §8.1 exempts ⌘Enter and ⌘J from the rule that shortcuts are disabled
   * inside a text field, so both belong to the whole composer. Bound to the
   * body alone, ⌘Enter sent from the message but did nothing from Subject or
   * the recipient fields — where someone finishing a short reply is just as
   * likely to be.
   */
  function onComposerKeyDown(e: React.KeyboardEvent) {
    if (!(e.metaKey || e.ctrlKey)) return;
    if (e.key === 'Enter') {
      void send();
      e.preventDefault();
    } else if (e.key.toLowerCase() === 'j') {
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
      ref={formRef}
      className={cn(
        styles.composer,
        variant === 'inline' && styles.inline,
        fill && styles.fillHeight,
        className,
      )}
      aria-label={draft.mode === 'new' ? 'New message' : `Reply to ${recipientLabel}`}
      onKeyDown={onComposerKeyDown}
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
            onKeyDown={(e) => {
              // §5.12 binds send to ⌘Enter, not Enter. A single text input in a
              // form means the browser submits it on Enter — so leaving the
              // subject line, which is close to a reflex, sent the message.
              //
              // ⌘Enter belongs to the form handler above; without the modifier
              // check this also jumped focus into the body on its way to
              // sending, which looks like a glitch when Send is disabled.
              if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey) {
                e.preventDefault();
                bodyRef.current?.focus();
              }
            }}
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
        ariaDescribedBy={showProvenance ? `${provenanceId}-spoken` : undefined}
        busy={generating}
        textareaRef={bodyRef}
        minHeight={variant === 'inline' ? 160 : 200}
        fill={fill}
      />

      {/*
        §4.7 requires all three of tint, mono label and "a visually hidden
        prefix for assistive technology". Only the visible row existed, and
        describing the body with it read the tone buttons aloud too: "Drafted by
        Pigeon Shorter Friendlier Firmer Discard draft". This says just the
        prefix; the row beside it stays a set of ordinary buttons.
      */}
      {showProvenance && (
        <span className="visually-hidden" id={`${provenanceId}-spoken`}>
          {draft.aiState === 'edited'
            ? 'Drafted by Pigeon, edited by you:'
            : 'Drafted by Pigeon:'}
        </span>
      )}

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

      {/*
        Two rewrites at once would leave the later one holding a "previous body"
        the earlier had already replaced, so Undo would restore text the user
        never wrote. Nothing here is disabled to prevent that: both retry paths
        clear `draftError` on entry, so this block — and its button — are gone
        before a second click is possible. Tested rather than assumed.
      */}
      {draftError && (
        <div className={cn('t-sm', styles.errorBlock)} role="alert">
          {draftError}
          <div className={styles.errorActions}>
            <Button
              variant="tertiary"
              size="sm"
              onClick={() => void (failedTone ? applyTone(failedTone) : generate())}
            >
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

      {/*
       * A restored draft comes back without its files, and saying so is the
       * point of counting them: the alternative is someone sending a message
       * they believe still has the attachment on it.
       */}
      {droppedAttachments > 0 && draft.attachments.length === 0 && (
        <div className={cn('t-sm', styles.errorBlock)} role="status">
          {plural(droppedAttachments, 'attachment', 'attachments')} didn&apos;t survive the
          restart. Attach {droppedAttachments === 1 ? 'it' : 'them'} again before you send.
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
        {/*
          §3.5 3e — "Send is disabled with tooltip and helper text". The helper
          text was there and the tooltip was not. The wrapper is what listens,
          and a disabled button passes pointer events through to it, so hovering
          the greyed-out Send explains itself. Keyboard users can't focus a
          disabled button, which is why the helper text below stays the
          permanent explanation rather than the tooltip replacing it.
        */}
        {blockedReason ? (
          <Tooltip label={blockedReason}>
            <Button variant="primary" type="submit" loading={sending} disabled={sendDisabled}>
              Send
            </Button>
          </Tooltip>
        ) : (
          <Button variant="primary" type="submit" loading={sending} disabled={sendDisabled}>
            Send
          </Button>
        )}

        {/*
          aria-disabled rather than `disabled`: a disabled button takes no focus
          and dispatches no pointer events, so nothing that explains why it is
          off can be reached. No tooltip here — §6 C-28 gives this control the
          helper text below ("Connect a provider to draft replies.") and gives
          "Connect a provider in Settings → Assistant" to the Summarize button
          instead. Carrying both said the same thing twice, differently.
        */}
        <Button
          variant="secondary"
          loading={generating}
          disabled={sending}
          aria-disabled={!connected || undefined}
          iconLeading={<Icon name="pen" size={16} />}
          onClick={() => {
            if (connected) void generate();
          }}
        >
          Draft with Pigeon
        </Button>

        {/*
          Why-you-can't-send always wins over why-you-can't-draft. These used to
          be mutually exclusive on `connected`, so anyone who took D43's
          "Continue without the assistant" saw only "Connect a provider to draft
          replies." — offline, or with a malformed recipient, Send was greyed
          out with nothing on screen explaining it.
        */}
        {blockedReason ? (
          <span className={cn('t-xs', styles.helper, placeholderBlocked && styles.helperBlocked)}>
            {blockedReason}
          </span>
        ) : invalidRecipient ? (
          <span className={cn('t-xs', styles.helper, styles.helperBlocked)}>
            {invalidRecipient.email} isn't a complete address.
          </span>
        ) : (
          !connected && (
            <span className={cn('t-xs', styles.helper)}>Connect a provider to draft replies.</span>
          )
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
