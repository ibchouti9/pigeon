import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useMinimumVisible } from '../../hooks/useMinimumVisible';
import { defaultCollapse, firstExpandedId, readerStartOffset } from './readerLayout';
import { cn } from '../../lib/cn';
import { displayName, joinNames, plural } from '../../lib/format';
import type { Address, MailView, Message, Thread } from '../../types';
import { isSingleColumn, type Breakpoint } from '../../hooks/useBreakpoint';
import { AiBlock, type AiBlockState } from '../primitives/AiBlock';
import { Button } from '../primitives/Button';
import { Icon, type IconName } from '../primitives/Icon';
import { PostmarkRing } from '../primitives/Postmark';
import { SkeletonBar, SkeletonCircle, Tooltip } from '../primitives/Feedback';
import { MessageBlock } from './MessageBlock';
import { LaneTag } from './LaneTag';
import type { Lane, LaneAssignment } from '../../data/lanes';
import styles from './ThreadReader.module.css';

export type ReplyMode = 'reply' | 'reply-all' | 'forward';
export type ThreadReaderStatus = 'none' | 'loading' | 'error' | 'ready';

export interface ThreadReaderProps {
  status: ThreadReaderStatus;
  thread?: Thread;
  place: MailView;
  selfEmail: string;
  online: boolean;
  breakpoint: Breakpoint;
  /** Tablet, below 880px — "← {backLabel}" above the subject (§5.0, §5.6). */
  backLabel?: string;
  onBack?: () => void;
  onRetryLoad?: () => void;
  onArchive?: () => void;
  /** Reply / reply all / forward. */
  onReply?: (mode: ReplyMode) => void;
  /**
   * The expanded inline composer, when a reply is open. Replaces the collapsed
   * "Reply to {name}" affordance at the foot of the thread (D14).
   */
  replySlot?: ReactNode;
  /**
   * What to read after this one, on a phone.
   *
   * The list and the reader share a column there, so finishing a conversation
   * means going back and finding your place again — several times over, for
   * the one activity a phone inbox is mostly used for. Saying what is next
   * turns that into one tap, at the point your thumb has already reached.
   *
   * Next only, no previous. Mail is read downward, and a control for going
   * back up the list is a second row of chrome for a direction almost nobody
   * travels.
   */
  nextInList?: { sender: string; subject: string; onOpen: () => void };
  /**
   * The subject from the list row, for the states where the thread itself
   * hasn't arrived. §5.6 asks the header to show it rather than a skeleton.
   */
  pendingSubject?: string;
  /**
   * Both undefined renders no block at all — which is C-28's degraded form, not
   * an empty tinted box. `MailPlaceScreen` supplies them from `useThreadSummary`.
   */
  summary?: string[];
  summaryState?: AiBlockState;
  /** §7.6's rate-limit line, when that is what went wrong (C-10's failed state). */
  summaryFailedText?: string;
  onRetrySummary?: () => void;
  onSummarize?: () => void;
  hasProvider?: boolean;
  /**
   * Inbox only, and absent when lanes are off. The reader is where "why is
   * this here" gets asked, and the only place with room to answer it.
   */
  lane?: LaneAssignment;
  onCorrectLane?: (lane: Lane) => void;
  onClearLaneCorrection?: () => void;
}

function nameFor(addr: Address, selfEmail: string): string {
  return addr.email === selfEmail ? 'you' : displayName(addr);
}

/** Unique participant names in order of first appearance across the thread. */
function collectParticipants(messages: Message[], selfEmail: string): string[] {
  const seen = new Map<string, string>();
  for (const m of messages) {
    for (const addr of [m.from, ...m.to, ...m.cc]) {
      if (!seen.has(addr.email)) seen.set(addr.email, nameFor(addr, selfEmail));
    }
  }
  return Array.from(seen.values());
}

/** C-28's reason, on the tooltip and — where nothing hovers — in the name. */
const SUMMARIZE_OFF = 'Connect a provider in Settings → Assistant';

const HEADER_ICONS: { mode: ReplyMode; icon: IconName; label: string }[] = [
  { mode: 'reply', icon: 'reply', label: 'Reply' },
  { mode: 'reply-all', icon: 'reply-all', label: 'Reply all' },
  { mode: 'forward', icon: 'forward', label: 'Forward' },
];

/** §5.6 — read one conversation and act on it without leaving the pane. */
/**
 * §4.2's 24-hour window, the same one the arrival ring uses. Shared with
 * MailListColumn by copy rather than by import only because that one is about
 * a ring on a row; if a third caller appears it belongs in lib.
 */
function isNewlyApproved(approvedAt: string | undefined): boolean {
  if (!approvedAt) return false;
  const age = Date.now() - new Date(approvedAt).getTime();
  return age >= 0 && age < 24 * 60 * 60 * 1000;
}

export function ThreadReader({
  status,
  thread,
  place,
  selfEmail,
  online,
  breakpoint,
  backLabel,
  onBack,
  onRetryLoad,
  onArchive,
  onReply,
  replySlot,
  nextInList,
  pendingSubject,
  summary,
  summaryState,
  summaryFailedText,
  onRetrySummary,
  onSummarize,
  hasProvider,
  lane,
  onCorrectLane,
  onClearLaneCorrection,
}: ThreadReaderProps) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const [collapsedOverrides, setCollapsedOverrides] = useState<Record<string, boolean>>({});
  const [quotedOpen, setQuotedOpen] = useState<Record<string, boolean>>({});
  const [hiddenSummaryFor, setHiddenSummaryFor] = useState<Record<string, boolean>>({});
  // C-21 — 200ms minimum, so a cached thread doesn't flash a skeleton reader.
  const showSkeleton = useMinimumVisible(status === 'loading');

  const threadId = thread?.id;
  const startId = thread ? firstExpandedId(thread.messages, defaultCollapse(thread.messages)) : null;

  /*
   * Open a long thread where reading starts. Only when the collapsed history is
   * deep enough to push that message off screen — on a short thread the pane
   * stays at the top, where §5.6 puts the summary block.
   */
  useEffect(() => {
    const body = bodyRef.current;
    if (!body || !startId) return;

    const target = [...body.querySelectorAll('[data-message-id]')].find(
      (el) => el.getAttribute('data-message-id') === startId,
    );
    if (!target) return;

    const offset = readerStartOffset(
      target.getBoundingClientRect().top,
      body.getBoundingClientRect().top,
      body.clientHeight,
    );
    if (offset !== null) body.scrollTop += offset;
  }, [threadId, startId]);

  if (status === 'none' || !thread) {
    /*
     * §5.6 — the header "renders the subject from the list row immediately (no
     * skeleton for text we already have)", and the error state keeps its header
     * with the actions disabled. Both states used to drop the header entirely:
     * loading rendered `&nbsp;` where the subject belongs, and the error state
     * replaced the whole pane with a centred block.
     */
    const placeholderHeader = (
      <header className={styles.header}>
        <div className={styles.headerRow1}>
          <h1 className={cn('t-display-sm', styles.subject)}>
            {pendingSubject || '\u00a0'}
          </h1>
          <div className={styles.actions}>
            {HEADER_ICONS.map(({ mode, icon, label }) => (
              <Button key={mode} variant="icon" size="sm" aria-label={label} aria-disabled="true">
                <Icon name={icon} size={16} />
              </Button>
            ))}
          </div>
        </div>
      </header>
    );

    if (showSkeleton) {
      return (
        <div className={styles.pane}>
          {placeholderHeader}
          <div className={styles.body}>
            <span className="visually-hidden">Loading thread</span>
            <div className={styles.skeletonMessages} aria-hidden="true">
              {[0, 1, 2].map((i) => (
                <div key={i} className={styles.skeletonMessage}>
                  <SkeletonCircle size={44} />
                  <div className={styles.skeletonMessageBody}>
                    <SkeletonBar width="30%" />
                    <SkeletonBar width="88%" />
                    <SkeletonBar width="60%" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      );
    }

    if (status === 'error') {
      return (
        <div className={styles.pane}>
          {placeholderHeader}
          <div className={cn(styles.body, styles.centered)}>
            <div className={styles.errorBlock}>
              <p className="t-md">This thread didn't load. It's still in Gmail.</p>
              {onRetryLoad && (
                <Button variant="secondary" onClick={onRetryLoad}>
                  Try again
                </Button>
              )}
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className={cn(styles.pane, styles.centered)}>
        <div className={styles.noSelection}>
          <PostmarkRing size={32} strokeWidth={1.5} className={styles.noSelectionRing} />
          <p className={cn('t-base', styles.noSelectionText)}>Select a thread to read it.</p>
        </div>
      </div>
    );
  }

  const messages = thread.messages;

  /*
   * C-8: "only for senders approved less than 24 hours ago; approved senders'
   * images load normally".
   *
   * The rule is about what an image request tells the sender. Fetching one is
   * a read receipt — it reports that the address is live and the mail was
   * opened, at a known minute — and the Screener's promise is that a sender
   * the user has only just let through learns nothing they didn't already
   * know. After a day of ordinary correspondence there is nothing left to
   * protect, and blocking images forever would just make the product worse
   * than the one it replaces.
   */
  const blockImages = isNewlyApproved(thread.approvedAt);
  const defaults = defaultCollapse(messages);
  const participants = collectParticipants(messages, selfEmail);

  const seenAddresses = new Set<string>();
  const lastOther = [...messages].reverse().find((m) => !m.isFromUser);
  const replyToName = lastOther ? nameFor(lastOther.from, selfEmail) : (participants[0] ?? 'the sender');
  // Who a lane correction is recorded against: the newest message that is not
  // the user's own, which is the same sender the row and the classifier used.
  const laneSender = lastOther?.from ?? messages[messages.length - 1]?.from ?? { name: '', email: '' };

  const showBack = isSingleColumn(breakpoint) && backLabel;
  // A phone's action row: five controls and a back link in 375px.
  const compact = breakpoint === 'phone';
  const showSummaryBlock =
    !hiddenSummaryFor[thread.id] && (summary !== undefined || summaryState !== undefined);
  // C-28 — with no provider the button is rendered *disabled* with a tooltip,
  // not hidden. Removing it would make the capability invisible rather than
  // unavailable, and a user would never learn it exists.
  // C-10 — "Hide" means the block is gone for the session. Offering to
  // regenerate what the user just dismissed is the opposite of honouring it, so
  // a hidden summary suppresses the button too.
  const showSummarizeButton =
    !showSummaryBlock && !hiddenSummaryFor[thread.id] && Boolean(onSummarize);
  const summarizeDisabled = hasProvider === false;

  const archiveLabel = place === 'inbox' ? 'Archive' : 'Move to inbox';
  const archiveIcon: IconName = place === 'inbox' ? 'archive' : 'inbox';

  return (
    <div className={styles.pane}>
      <header className={styles.header}>
        {/*
          Single column: the back link and the actions share the top row, and
          the subject gets the next one to itself.

          Beside the subject — where they sit on a desktop — five controls left
          a 375px screen roughly forty pixels of subject, so every conversation
          in the reader was called "Re: w…". The row above is empty on exactly
          the widths where the subject has no room, which is what makes it the
          right place to put them.
        */}
        <div className={showBack ? styles.backRow : styles.headerRow1}>
          {showBack ? (
            <button type="button" className={cn('t-sm', styles.back)} onClick={onBack}>
              <Icon name="chevron-left" size={16} />
              {backLabel}
            </button>
          ) : (
            <h1 className={cn('t-display-sm', styles.subject)}>{thread.subject}</h1>
          )}
          <div className={styles.actions}>
            {showSummarizeButton &&
              (summarizeDisabled ? (
                // aria-disabled, not `disabled`. A disabled button takes no
                // focus and dispatches no mouse events, so C-28's tooltip —
                // the only thing that says *why* it is off — could not be
                // reached by pointer or by keyboard. This way the control keeps
                // its tab stop, and the reason is one hover or Tab away.
                //
                // On a phone there is no hover to reach it with either, which
                // is why the reason is also the accessible name.
                <Tooltip label={SUMMARIZE_OFF}>
                  <Button
                    variant={compact ? 'icon' : 'tertiary'}
                    size="sm"
                    aria-disabled="true"
                    aria-label={compact ? `Summarize thread. ${SUMMARIZE_OFF}` : undefined}
                    onClick={(e) => e.preventDefault()}
                  >
                    {compact ? <Icon name="sparkle" size={16} /> : 'Summarize thread'}
                  </Button>
                </Tooltip>
              ) : compact ? (
                /*
                 * The label costs half the action row at 375px. As an icon it
                 * costs a quarter of one control, and the sparkle is what
                 * every other AI surface in the app is already marked with.
                 */
                <Button
                  variant="icon"
                  size="sm"
                  aria-label="Summarize thread"
                  onClick={onSummarize}
                >
                  <Icon name="sparkle" size={16} />
                </Button>
              ) : (
                <Button variant="tertiary" size="sm" onClick={onSummarize}>
                  Summarize thread
                </Button>
              ))}
            {HEADER_ICONS.map(({ mode, icon, label }) => (
              <Tooltip key={mode} label={label}>
                <Button
                  variant="icon"
                  size="sm"
                  aria-label={label}
                  aria-disabled={!online || undefined}
                  onClick={() => {
                    if (online) onReply?.(mode);
                  }}
                >
                  <Icon name={icon} size={16} />
                </Button>
              </Tooltip>
            ))}
            <Tooltip label={archiveLabel}>
              <Button
                variant="icon"
                size="sm"
                aria-label={archiveLabel}
                aria-disabled={!online || undefined}
                onClick={() => {
                  if (online) onArchive?.();
                }}
              >
                <Icon name={archiveIcon} size={16} />
              </Button>
            </Tooltip>
          </div>
        </div>
        {showBack && (
          <h1 className={cn('t-display-sm', styles.subject)}>{thread.subject}</h1>
        )}
        <p className={cn('t-sm', styles.meta)}>
          {plural(messages.length, 'message')} · {joinNames(participants)}
          {lane && onCorrectLane && onClearLaneCorrection && (
            <>
              {' · '}
              <LaneTag
                assignment={lane}
                senderEmail={laneSender.email}
                senderName={displayName(laneSender)}
                onCorrect={onCorrectLane}
                onClear={onClearLaneCorrection}
              />
            </>
          )}
        </p>
      </header>

      <div className={styles.body} ref={bodyRef}>
        {showSummaryBlock && (
          <AiBlock
            kind="summary"
            state={summaryState ?? 'ready'}
            content={summary}
            failedText={summaryFailedText}
            onRetry={onRetrySummary}
            onHide={() => setHiddenSummaryFor((s) => ({ ...s, [thread.id]: true }))}
            className={styles.summary}
          />
        )}

        {messages.map((m) => {
          const showAddress = !seenAddresses.has(m.from.email);
          seenAddresses.add(m.from.email);
          const collapsible = defaults.has(m.id);
          const collapsed = collapsedOverrides[m.id] ?? collapsible;
          const recipientsLabel = `to ${joinNames(
            [...m.to, ...m.cc].map((a) => nameFor(a, selfEmail)),
          )}`;

          return (
            <MessageBlock
              key={m.id}
              message={m}
              senderName={m.isFromUser ? 'You' : displayName(m.from)}
              showAddress={showAddress}
              recipientsLabel={recipientsLabel}
              collapsed={collapsed}
              collapsible={collapsible}
              onToggleCollapse={() =>
                setCollapsedOverrides((s) => ({ ...s, [m.id]: !collapsed }))
              }
              blockImages={blockImages && !m.isFromUser}
              quotedOpen={Boolean(quotedOpen[m.id])}
              onToggleQuoted={() =>
                setQuotedOpen((s) => ({ ...s, [m.id]: !s[m.id] }))
              }
            />
          );
        })}

        {/* D14 — replies compose inline at the foot of the thread, so the
            quoted context stays visible while writing. The dock is for new
            mail only (D13). */}
        {replySlot ?? (
          <button
            type="button"
            className={cn('t-base', styles.replyAffordance)}
            aria-disabled={!online || undefined}
            onClick={() => {
              if (online) onReply?.('reply');
            }}
          >
            Reply to {replyToName}
          </button>
        )}

        {/*
          Below the reply, not above it: answering is what you came to do and
          moving on is what you do when you have decided not to.
        */}
        {showBack && nextInList && (
          <button type="button" className={styles.next} onClick={nextInList.onOpen}>
            <span className={cn('t-xs', styles.nextLabel)}>NEXT IN {backLabel?.toUpperCase()}</span>
            <span className={cn('t-base', 'truncate', styles.nextSender)}>
              {nextInList.sender}
            </span>
            <span className={cn('t-sm', 'truncate', styles.nextSubject)}>
              {nextInList.subject || '(no subject)'}
            </span>
          </button>
        )}
      </div>
    </div>
  );
}
