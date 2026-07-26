import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';
import type { Place } from '../../types';
import { Button } from '../primitives/Button';
import { Checkbox } from '../primitives/Field';
import { Icon } from '../primitives/Icon';
import { Monogram } from '../primitives/Monogram';
import { Tooltip } from '../primitives/Feedback';
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
  place: Place;
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

  return (
    <div
      ref={rowRef}
      role="listitem"
      className={cn(
        styles.row,
        checked ? styles.fillChecked : open && styles.fillOpen,
        open && styles.hasBar,
        cursor && styles.cursor,
        departing && styles.departing,
      )}
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
              aria-label="First message since approval"
            />
          )}
          <span className={cn('t-mono-sm', styles.timestampText)}>{timestamp}</span>
        </span>
      </button>
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
    </div>
  );
}
