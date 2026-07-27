import { useEffect, useRef, useState } from 'react';
import { cn } from '../../lib/cn';
import { LANES, LANE_LABELS, type Lane, type LaneAssignment } from '../../data/lanes';
import { Icon } from '../primitives/Icon';
import styles from './LaneTag.module.css';

export interface LaneTagProps {
  assignment: LaneAssignment;
  /** The address a correction is recorded against. */
  senderEmail: string;
  senderName: string;
  onCorrect: (lane: Lane) => void;
  onClear: () => void;
}

/**
 * "Sorted into Offers", in the reader's meta line, and the way to argue with it.
 *
 * This is the whole difference between lanes and Gmail's tabs. A tab decided by
 * a server you cannot see, cannot question and cannot correct is a thing people
 * put up with; the same decision, shown with its reason and reversible in one
 * click, is a thing people trust. So the reason is never hidden behind a
 * hover — it is the first line of the menu, in the words the classifier used.
 *
 * The correction is recorded against the sender, not the thread, which is why
 * the menu says the address out loud. "Always" is a promise, and the user
 * should be able to see exactly who it is being made about.
 */
export function LaneTag({ assignment, senderEmail, senderName, onCorrect, onClear }: LaneTagProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLSpanElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;

    function onDown(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return;
      setOpen(false);
      // §8.1's Esc is a layer stack and this is a layer. Without stopping it
      // the same press also closed the thread underneath.
      e.stopPropagation();
      buttonRef.current?.focus();
    }

    document.addEventListener('mousedown', onDown);
    // Capture, so this runs before the window-level handler that closes the
    // reader — the innermost layer has to win.
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  const source = assignment.source;

  return (
    <span className={styles.root} ref={rootRef}>
      <button
        ref={buttonRef}
        type="button"
        className={cn('t-sm', styles.tag, open && styles.tagOpen)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={`Sorted into ${LANE_LABELS[assignment.lane]}. ${assignment.why}. Change where mail from ${senderName} goes.`}
        onClick={() => setOpen((v) => !v)}
      >
        {LANE_LABELS[assignment.lane]}
        <Icon name="chevron-down" size={16} className={styles.chevron} />
      </button>

      {open && (
        <div className={styles.menu} role="menu">
          <p className={cn('t-xs', styles.why)}>
            {assignment.why}
            {source === 'assistant' && <span className={styles.byModel}> — your model's read</span>}
          </p>

          <div className={styles.divider} />

          <p className={cn('t-xs', styles.menuLabel)}>Always put {senderEmail} in</p>
          {LANES.map((lane) => (
            <button
              key={lane}
              type="button"
              role="menuitemradio"
              aria-checked={assignment.lane === lane}
              className={cn('t-sm', styles.item, assignment.lane === lane && styles.itemCurrent)}
              onClick={() => {
                onCorrect(lane);
                setOpen(false);
              }}
            >
              <span className={styles.check} aria-hidden="true">
                {assignment.lane === lane ? '·' : ''}
              </span>
              {LANE_LABELS[lane]}
            </button>
          ))}

          {source === 'user' && (
            <>
              <div className={styles.divider} />
              <button
                type="button"
                role="menuitem"
                className={cn('t-sm', styles.item, styles.itemReset)}
                onClick={() => {
                  onClear();
                  setOpen(false);
                }}
              >
                Sort this sender automatically again
              </button>
            </>
          )}
        </div>
      )}
    </span>
  );
}
