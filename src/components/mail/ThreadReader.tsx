import { useState, type ReactNode } from 'react';
import { cn } from '../../lib/cn';
import { displayName, joinNames, plural } from '../../lib/format';
import type { Address, Message, Place, Thread } from '../../types';
import type { Breakpoint } from '../../hooks/useBreakpoint';
import { AiBlock, type AiBlockState } from '../primitives/AiBlock';
import { Button } from '../primitives/Button';
import { Icon, type IconName } from '../primitives/Icon';
import { PostmarkRing } from '../primitives/Postmark';
import { SkeletonBar, SkeletonCircle, Tooltip } from '../primitives/Feedback';
import { MessageBlock } from './MessageBlock';
import styles from './ThreadReader.module.css';

export type ReplyMode = 'reply' | 'reply-all' | 'forward';
export type ThreadReaderStatus = 'none' | 'loading' | 'error' | 'ready';

export interface ThreadReaderProps {
  status: ThreadReaderStatus;
  thread?: Thread;
  place: Place;
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
  /** Undefined summary + summaryState renders nothing — another agent wires the AI. */
  summary?: string[];
  summaryState?: AiBlockState;
  onRetrySummary?: () => void;
  onSummarize?: () => void;
  hasProvider?: boolean;
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

/**
 * §5.6 — expanded by default except messages the user sent that already have a
 * later message after them, and any message beyond the 8 most recent.
 */
function defaultCollapse(messages: Message[]): Set<string> {
  const n = messages.length;
  const collapsed = new Set<string>();
  messages.forEach((m, i) => {
    const hasLaterMessage = i < n - 1;
    const beyondRecent8 = i < n - 8;
    if ((m.isFromUser && hasLaterMessage) || beyondRecent8) collapsed.add(m.id);
  });
  return collapsed;
}

const HEADER_ICONS: { mode: ReplyMode; icon: IconName; label: string }[] = [
  { mode: 'reply', icon: 'reply', label: 'Reply' },
  { mode: 'reply-all', icon: 'reply-all', label: 'Reply all' },
  { mode: 'forward', icon: 'forward', label: 'Forward' },
];

/** §5.6 — read one conversation and act on it without leaving the pane. */
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
  summary,
  summaryState,
  onRetrySummary,
  onSummarize,
  hasProvider,
}: ThreadReaderProps) {
  const [collapsedOverrides, setCollapsedOverrides] = useState<Record<string, boolean>>({});
  const [quotedOpen, setQuotedOpen] = useState<Record<string, boolean>>({});
  const [hiddenSummaryFor, setHiddenSummaryFor] = useState<Record<string, boolean>>({});

  if (status === 'none' || !thread) {
    if (status === 'loading') {
      return (
        <div className={styles.pane}>
          <header className={styles.header}>
            <div className={styles.headerRow1}>
              <h1 className={cn('t-display-sm', styles.subject)}>&nbsp;</h1>
            </div>
          </header>
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
        <div className={cn(styles.pane, styles.centered)}>
          <div className={styles.errorBlock}>
            <p className="t-md">This thread didn't load. It's still in Gmail.</p>
            {onRetryLoad && (
              <Button variant="secondary" onClick={onRetryLoad}>
                Try again
              </Button>
            )}
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
  const defaults = defaultCollapse(messages);
  const participants = collectParticipants(messages, selfEmail);

  const seenAddresses = new Set<string>();
  const lastOther = [...messages].reverse().find((m) => !m.isFromUser);
  const replyToName = lastOther ? nameFor(lastOther.from, selfEmail) : (participants[0] ?? 'the sender');

  const showBack = breakpoint === 'narrow' && backLabel;
  const showSummaryBlock =
    !hiddenSummaryFor[thread.id] && (summary !== undefined || summaryState !== undefined);
  const showSummarizeButton =
    !showSummaryBlock && Boolean(onSummarize) && hasProvider !== false;

  const archiveLabel = place === 'inbox' ? 'Archive' : 'Move to inbox';
  const archiveIcon: IconName = place === 'inbox' ? 'archive' : 'inbox';

  return (
    <div className={styles.pane}>
      <header className={styles.header}>
        {showBack && (
          <button type="button" className={cn('t-sm', styles.back)} onClick={onBack}>
            <Icon name="chevron-left" size={16} />
            {backLabel}
          </button>
        )}
        <div className={styles.headerRow1}>
          <h1 className={cn('t-display-sm', styles.subject)}>{thread.subject}</h1>
          <div className={styles.actions}>
            {showSummarizeButton && (
              <Button variant="tertiary" size="sm" onClick={onSummarize}>
                Summarize thread
              </Button>
            )}
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
        <p className={cn('t-sm', styles.meta)}>
          {plural(messages.length, 'message')} · {joinNames(participants)}
        </p>
      </header>

      <div className={styles.body}>
        {showSummaryBlock && (
          <AiBlock
            kind="summary"
            state={summaryState ?? 'ready'}
            content={summary}
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
      </div>
    </div>
  );
}
