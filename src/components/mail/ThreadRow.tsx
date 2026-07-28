import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';
import { isPlace, type MailView } from '../../types';
import { Button } from '../primitives/Button';
import { Checkbox } from '../primitives/Field';
import { Icon } from '../primitives/Icon';
import { Monogram } from '../primitives/Monogram';
import { Tooltip } from '../primitives/Feedback';
import { COMMIT_PX, useRowSwipe } from './useRowSwipe';
import styles from './ThreadRow.module.css';

export interface ThreadRowProps {
  /** Sender display name (D16 — the monogram is always adjacent to this text). */
  sender: string;
  senderEmail: string;
  subject: string;
  snippet: string;
  /**
   * §5.11 marks matched terms in the subject and snippet. Passed alongside the
   * plain strings rather than replacing them, because the accessible name is
   * built from the text and must stay a flat string.
   */
  subjectNode?: ReactNode;
  snippetNode?: ReactNode;
  /** Already formatted for display, e.g. `formatListTimestamp`. */
  timestamp: string;
  /** Spoken relative time for the row's accessible name, e.g. "2 hours ago". */
  timestampSpoken: string;
  unread: boolean;
  messageCount: number;
  hasAttachment: boolean;
  isNewlyApproved: boolean;
  checked: boolean;
  cursor: boolean;
  open: boolean;
  /**
   * The list is in selection mode, so every checkbox is showing. Phone only:
   * a checkbox that appears on hover appears never on a touch screen.
   */
  selecting?: boolean;
  place: MailView;
  online: boolean;
  /** Playing the §4.6 row-depart animation before it leaves the list. */
  departing?: boolean;
  /** Roving tabindex — exactly one row button in the whole list is 0 (§8.4). */
  tabIndex: 0 | -1;
  onOpen: () => void;
  onToggleCheck: () => void;
  onArchive: () => void;
  rowRef?: (el: HTMLDivElement | null) => void;
  buttonRef?: (el: HTMLButtonElement | null) => void;
}

/**
 * C-5 Thread list item. The three independent states (D29) — cursor, open,
 * checked — are driven by separate class names so they stay legible together:
 * outline (cursor) over fill (checked/open) over the left bar (open).
 */
export function ThreadRow({
  sender,
  senderEmail,
  subject,
  snippet,
  subjectNode,
  snippetNode,
  timestamp,
  timestampSpoken,
  unread,
  messageCount,
  hasAttachment,
  isNewlyApproved,
  checked,
  cursor,
  open,
  selecting,
  place,
  online,
  departing,
  tabIndex,
  onOpen,
  onToggleCheck,
  onArchive,
  rowRef,
  buttonRef,
}: ThreadRowProps) {
  const accessibleName = `${sender}, ${subject}, ${timestampSpoken}${unread ? ', unread' : ''}`;
  const archiveLabel = place === 'inbox' ? 'Archive' : 'Move to inbox';
  /*
   * Sent and Drafts are reads over labels, not §2.1 places, so there is
   * nowhere for a row to be moved *to*. Offering the control anyway would be
   * an affordance that says it works and doesn't.
   */
  const movable = isPlace(place);

  /*
   * The same action the hover button performs, reached with a thumb — except
   * in selection mode, where a horizontal drag is how a finger picks several
   * rows and archiving one out from under that is the opposite of what was
   * asked.
   */
  const swipe = useRowSwipe(onArchive, movable && online && !selecting);
  const past = swipe.offset <= -COMMIT_PX;

  return (
    <div
      ref={rowRef}
      role="listitem"
      className={cn(
        styles.row,
        checked ? styles.fillChecked : open && styles.fillOpen,
        open && styles.hasBar,
        cursor && styles.cursor,
        selecting && styles.selecting,
        departing && styles.departing,
      )}
      {...swipe.handlers}
    >
      {/*
        The panel the row slides off, revealed rather than animated in: it is
        already there, under the row, and the gesture uncovers it. `aria-hidden`
        because the action it stands for is on the button below, which is what
        a screen reader should find.
      */}
      {swipe.active && (
        <span
          className={cn(styles.swipeBack, past && styles.swipeBackArmed)}
          aria-hidden="true"
        >
          <Icon name={place === 'inbox' ? 'archive' : 'inbox'} size={20} />
        </span>
      )}
      <div
        className={cn(styles.sliding, swipe.active && styles.slidingActive)}
        style={swipe.offset ? { transform: `translateX(${swipe.offset}px)` } : undefined}
      >
      <Checkbox
        className={styles.checkbox}
        checked={checked}
        onChange={onToggleCheck}
        tabIndex={-1}
        aria-label={`Select thread from ${sender}`}
      />
      <button
        ref={buttonRef}
        type="button"
        tabIndex={tabIndex}
        aria-current={open || undefined}
        aria-label={accessibleName}
        className={cn(styles.content, 'focus-inset')}
        onClick={onOpen}
      >
        <span className={styles.dotSlot}>
          {unread && <span className={styles.dot} aria-hidden="true" />}
        </span>
        <Monogram name={sender} email={senderEmail} size={28} className={styles.monogram} />
        <span className={styles.middle}>
          <span className={styles.line1}>
            <span className={cn('t-base', styles.senderName)}>{sender}</span>
            {messageCount > 1 && (
              <span className={cn('t-xs', styles.senderCount)}>· {messageCount}</span>
            )}
          </span>
          <span className={cn('t-sm', styles.line2)}>
            <span className={unread ? styles.subjectUnread : styles.subject}>
              {subjectNode ?? subject}
            </span>
            {hasAttachment && (
              <Icon name="attach" size={16} className={styles.attachIcon} />
            )}
            <span className={styles.snippet}> — {snippetNode ?? snippet}</span>
          </span>
        </span>
        <span className={styles.right}>
          {isNewlyApproved && (
            <span
              className={styles.arrivalRing}
              role="img"
              aria-label="First message since you approved this sender"
            />
          )}
          <span className={cn('t-mono-sm', styles.timestampText)}>{timestamp}</span>
        </span>
      </button>
      {movable && (
      <span className={styles.archiveHover}>
        <Tooltip label={archiveLabel}>
          <Button
            variant="icon"
            size="sm"
            tabIndex={-1}
            className="focus-inset"
            aria-label={archiveLabel}
            aria-disabled={!online || undefined}
            onClick={(e) => {
              e.stopPropagation();
              if (!online) return;
              onArchive();
            }}
          >
            <Icon name={place === 'inbox' ? 'archive' : 'inbox'} size={16} />
          </Button>
        </Tooltip>
      </span>
      )}
      </div>
    </div>
  );
}
