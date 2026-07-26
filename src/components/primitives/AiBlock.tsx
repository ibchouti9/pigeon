import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';
import { Button } from './Button';
import { SkeletonBar } from './Feedback';
import styles from './AiBlock.module.css';

export type AiBlockKind = 'summary' | 'digest' | 'read';
export type AiBlockState = 'loading' | 'ready' | 'failed';

/** §4.7 — the label and the screen-reader prefix travel together. */
const COPY: Record<AiBlockKind, { label: string; loadingLabel: string; prefix: string }> = {
  summary: {
    label: 'Pigeon summary',
    loadingLabel: 'Pigeon is reading this thread',
    prefix: 'Pigeon summary:',
  },
  digest: {
    label: 'This week',
    loadingLabel: 'Pigeon is reading your Screener',
    prefix: 'Pigeon summary:',
  },
  read: {
    label: "Pigeon's read",
    loadingLabel: 'Pigeon is reading this message',
    prefix: "Pigeon's read of this message:",
  },
};

export interface AiBlockProps {
  kind: AiBlockKind;
  state: AiBlockState;
  /** A string renders as one sentence; an array renders as bullets. */
  content?: string | string[];
  /** Overrides the default label text, keeping the ◆ glyph. */
  label?: string;
  onRetry?: () => void;
  onHide?: () => void;
  /** Extra controls rendered under the content (the digest's grouping chips). */
  footer?: ReactNode;
  /** Failed-state copy, when it differs from the default. */
  failedText?: string;
  className?: string;
}

/**
 * C-10. Forbidden treatments: left accent stripe, gradient, sparkle iconography,
 * animated reveal, the word "magic", any purple button (§4.7).
 */
export function AiBlock({
  kind,
  state,
  content,
  label,
  onRetry,
  onHide,
  footer,
  failedText,
  className,
}: AiBlockProps) {
  const copy = COPY[kind];

  if (state === 'failed') {
    return (
      <div className={cn(styles.failed, className)}>
        <span className={cn('t-mono-sm', styles.label)}>
          ◆ {failedText ?? 'Summary unavailable.'}
        </span>
        {onRetry && (
          <Button variant="tertiary" size="sm" onClick={onRetry}>
            Try again
          </Button>
        )}
      </div>
    );
  }

  const heading = state === 'loading' ? copy.loadingLabel : (label ?? copy.label);

  return (
    <section
      aria-label={label ?? copy.label}
      aria-live="polite"
      aria-busy={state === 'loading' || undefined}
      className={cn(styles.block, className)}
    >
      <div className={styles.labelRow}>
        <h3 className={cn('t-mono-sm', styles.label)}>◆ {heading}</h3>
        {onHide && state === 'ready' && (
          <Button variant="tertiary" size="sm" onClick={onHide}>
            Hide
          </Button>
        )}
      </div>

      <span className="visually-hidden">{copy.prefix}</span>

      {state === 'loading' ? (
        <div className={styles.skeletons}>
          <SkeletonBar width="92%" />
          <SkeletonBar width="78%" />
          <SkeletonBar width="54%" />
        </div>
      ) : Array.isArray(content) ? (
        <ul className={styles.bullets}>
          {content.map((line, i) => (
            <li key={i} className={cn('t-sm', styles.bullet)}>
              <span className={styles.marker} aria-hidden="true" />
              <span>{line}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className={cn('t-md', styles.sentence)}>{content}</p>
      )}

      {footer}
    </section>
  );
}

/**
 * C-28 — the shared treatment for an AI surface with no provider connected.
 * Never an error, never a modal, never a nag.
 */
export function DegradedAiBlock({
  headline,
  body,
  action,
  className,
}: {
  headline: string;
  body?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn(styles.degraded, className)}>
      <p className="t-md">{headline}</p>
      {body && <p className={cn('t-sm', styles.degradedBody)}>{body}</p>}
      {action}
    </div>
  );
}
