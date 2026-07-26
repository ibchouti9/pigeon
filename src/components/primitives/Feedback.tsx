import { useEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from '../../lib/cn';
import { PostmarkRing } from './Postmark';
import styles from './Feedback.module.css';

/* -------------------------------------------------------------------------- */
/* C-21 Skeleton — static tinted blocks, never a shimmer (D33).                */
/* -------------------------------------------------------------------------- */

/** Bar widths alternate 60% / 40% / 25% to suggest text. */
const WIDTHS = ['60%', '40%', '25%'];

export function SkeletonBar({
  width,
  height = 12,
  className,
}: {
  width?: string;
  height?: 12 | 16;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(styles.bar, className)}
      style={{ display: 'block', width: width ?? '60%', height }}
    />
  );
}

export function SkeletonCircle({ size = 28 }: { size?: number }) {
  return <span aria-hidden="true" className={styles.circle} style={{ width: size, height: size }} />;
}

/** A list of skeleton rows sized like C-5 thread rows. */
export function SkeletonRows({
  count = 8,
  height = 56,
  circle = 28,
  label = 'Loading',
}: {
  count?: number;
  height?: number;
  circle?: number;
  label?: string;
}) {
  return (
    <div className={styles.rows} aria-busy="true">
      <span className="visually-hidden">{label}</span>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className={styles.skeletonRow} style={{ height }}>
          <SkeletonCircle size={circle} />
          <div className={styles.skeletonRowText}>
            <SkeletonBar width={WIDTHS[i % 3]} height={12} />
            <SkeletonBar width={WIDTHS[(i + 1) % 3]} height={12} />
          </div>
        </div>
      ))}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* C-20 Empty state                                                            */
/* -------------------------------------------------------------------------- */

export interface EmptyStateProps {
  headline?: string;
  body: ReactNode;
  action?: ReactNode;
  secondaryAction?: ReactNode;
  /** The only two visuals in the product. */
  visual?: 'none' | 'blank-card' | 'ring';
  /** Region-level empty states use display-md; component-level uses text-lg. */
  level?: 'region' | 'component';
  className?: string;
}

export function EmptyState({
  headline,
  body,
  action,
  secondaryAction,
  visual = 'none',
  level = 'region',
  className,
}: EmptyStateProps) {
  return (
    <div className={cn(styles.empty, className)}>
      {visual === 'blank-card' && <div className={styles.blankCard} aria-hidden="true" />}
      {visual === 'ring' && (
        <PostmarkRing size={32} strokeWidth={1.5} className={styles.emptyVisual} />
      )}
      {headline && (
        <h2 className={cn(level === 'region' ? 't-display-md' : 't-lg', styles.emptyHeadline)}>
          {headline}
        </h2>
      )}
      <p className={cn('t-md', styles.emptyBody)}>{body}</p>
      {(action || secondaryAction) && (
        <div className={styles.emptyActions}>
          {action}
          {secondaryAction}
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* C-23 Progress bar                                                           */
/* -------------------------------------------------------------------------- */

export function ProgressBar({
  value,
  max,
  valueText,
  error,
  className,
}: {
  /** Null renders the static 25% fill used before the total is known. */
  value: number | null;
  max: number | null;
  valueText: string;
  error?: boolean;
  className?: string;
}) {
  const unknown = value === null || max === null || max === 0;
  const pct = unknown ? 25 : Math.min(100, Math.round((value / max) * 100));

  return (
    <div
      role="progressbar"
      aria-valuenow={unknown ? undefined : value}
      aria-valuemin={0}
      aria-valuemax={unknown ? undefined : max}
      aria-valuetext={valueText}
      className={cn(styles.track, className)}
    >
      <div
        className={cn(styles.fill, error && styles.fillError)}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* C-25 Tooltip — duplicates the control's aria-label, never replaces it.      */
/* -------------------------------------------------------------------------- */

export function Tooltip({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const show = () => {
    timer.current = setTimeout(() => setOpen(true), 400);
  };
  const hide = () => {
    if (timer.current) clearTimeout(timer.current);
    setOpen(false);
  };

  return (
    <span
      className={styles.tooltipWrap}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={() => setOpen(true)}
      onBlur={hide}
      onKeyDown={(e) => {
        if (e.key === 'Escape') hide();
      }}
    >
      {children}
      {open && (
        <span className={cn('t-xs', styles.tooltip)} aria-hidden="true">
          {label}
        </span>
      )}
    </span>
  );
}
