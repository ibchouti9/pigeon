import { forwardRef, useId } from 'react';
import type { HeldSender } from '../../types';
import { Button } from '../primitives/Button';
import { Monogram } from '../primitives/Monogram';
import { Postmark } from '../primitives/Postmark';
import { cn } from '../../lib/cn';
import { plural } from '../../lib/format';
import styles from './SenderCard.module.css';

export interface SenderCardProps {
  entry: HeldSender;
  /**
   * The live AI read for this sender (`useScreenerAi().reads[senderId]`).
   * Undefined for any reason — no provider, the Screener-reads toggle is
   * off, still loading, or the call failed — and section 5 is simply
   * omitted (§5.7 "Per-card AI read failed"), never shown empty.
   */
  aiRead?: string;
  /** Set while an approve/decline decision is animating out (§4.6). */
  deciding?: 'approved' | 'declined' | null;
  /**
   * Entrance animation for a card that just became top: `rise` after a
   * decision (§4.6 CARD RISE), `fromRight`/`fromLeft` after `j`/`k`
   * cycling (§5.7 — "animates out to the left ... returns from the right").
   */
  enter?: 'rise' | 'fromRight' | 'fromLeft' | null;
  /** C-6 error state: a 1px destructive border, held for 3s by the caller. */
  error?: boolean;
  disabled?: boolean;
  /** False for the transitional overlay copy of a departing card. */
  interactive?: boolean;
  onApprove?: () => void;
  onDecline?: () => void;
  onRead?: () => void;
  className?: string;
}

/**
 * C-6 Sender card. The seven numbered content slots from §5.7, the postmark
 * on decision, and the §4.6 depart/rise animations. Omits "Pigeon's read"
 * entirely (never empty) when there's no AI read to show.
 */
export const SenderCard = forwardRef<HTMLElement, SenderCardProps>(function SenderCard(
  {
    entry,
    aiRead,
    deciding = null,
    enter,
    error,
    disabled,
    interactive = true,
    onApprove,
    onDecline,
    onRead,
    className,
  },
  ref,
) {
  const nameId = useId();
  const subjectId = useId();
  const { sender, messages } = entry;
  const first = messages[0];
  const heldMany = messages.length > 1;
  const showRead = Boolean(aiRead);

  return (
    <article
      ref={ref}
      tabIndex={interactive ? 0 : -1}
      aria-hidden={interactive ? undefined : 'true'}
      aria-labelledby={`${nameId} ${subjectId}`}
      className={cn(
        styles.card,
        deciding === 'approved' && styles.departApproved,
        deciding === 'declined' && styles.departDeclined,
        enter === 'rise' && styles.rising,
        enter === 'fromRight' && styles.enterFromRight,
        enter === 'fromLeft' && styles.enterFromLeft,
        error && styles.error,
        className,
      )}
    >
      {/* 1. monogram · 2. name + address */}
      <div className={styles.header}>
        <Monogram name={sender.name} email={sender.email} size={40} />
        <div className={cn(styles.nameBlock, 'truncate')}>
          <h2 id={nameId} className={cn('t-xl', 'truncate', styles.name)}>
            {sender.name}
          </h2>
          <p className={cn('t-sm', 'truncate', styles.address)}>{sender.email}</p>
        </div>
      </div>

      {/* 3. hairline */}
      <hr className={styles.hr} />

      {/* 4. subject + snippet */}
      <div className={styles.message}>
        <p id={subjectId} className={cn('t-lg', styles.subject)}>
          {first.subject}
        </p>
        <p className={cn('t-sm', styles.snippet)}>{first.body}</p>
      </div>

      {/* 5. Pigeon's read — omitted entirely, never shown empty */}
      {showRead && (
        <section aria-label="Pigeon's read of this sender" className={styles.read}>
          <span className="visually-hidden">Pigeon's read of this sender:</span>
          <h3 className={cn('t-mono-sm', styles.readLabel)}>◆ PIGEON'S READ</h3>
          <p className={cn('t-sm', styles.readSentence)}>{aiRead}</p>
        </section>
      )}

      {/* 6/7. hairline + action row + read message */}
      <hr className={styles.hr} />
      <div className={styles.footer}>
        {heldMany && (
          <p className={cn('t-xs', styles.heldCount)}>{plural(messages.length, 'message')} held</p>
        )}
        <div className={styles.actions}>
          <Button
            variant="secondary-destructive"
            disabled={disabled || Boolean(deciding)}
            onClick={onDecline}
          >
            Decline sender
          </Button>
          <Button variant="primary" disabled={disabled || Boolean(deciding)} onClick={onApprove}>
            Approve sender
          </Button>
        </div>
        <Button
          variant="tertiary"
          fullWidth
          className={styles.readMessage}
          disabled={Boolean(deciding)}
          onClick={onRead}
        >
          {heldMany ? `Read ${plural(messages.length, 'message')}` : 'Read message'}
        </Button>
      </div>

      {deciding && (
        <div className={styles.postmarkOverlay} aria-hidden="true">
          <Postmark
            verb={deciding === 'approved' ? 'Approved' : 'Returned'}
            date={new Date().toISOString()}
            size={132}
            ink={deciding === 'approved' ? 'accent' : 'destructive'}
            decorative
            animate
          />
        </div>
      )}
    </article>
  );
});
