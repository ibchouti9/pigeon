import { cn } from '../../lib/cn';
import { formatPostmarkDate, formatPostmarkDateSpoken } from '../../lib/format';
import styles from './Postmark.module.css';

export type PostmarkVerb = 'Approved' | 'Returned' | 'Declined';

export interface PostmarkProps {
  verb: PostmarkVerb;
  /** ISO 8601 of the decision. */
  date: string;
  /** Diameter in px. Geometry scales from this (§4.2). */
  size?: number;
  ink?: 'accent' | 'destructive';
  /** Mono line only, no rings — used on Settings → Senders rows. */
  textOnly?: boolean;
  /** True when adjacent text already says this, per C-7. */
  decorative?: boolean;
  /** Runs the stamp animation on mount (§4.6). */
  animate?: boolean;
  className?: string;
}

/**
 * C-7 Postmark. The one loud element in the product (D3).
 * Geometry is identical everywhere and scales from `size`.
 */
export function Postmark({
  verb,
  date,
  size = 44,
  ink = 'accent',
  textOnly,
  decorative,
  animate,
  className,
}: PostmarkProps) {
  const dateLine = formatPostmarkDate(date);
  const label = `${verb} on ${formatPostmarkDateSpoken(date)}`;
  const color = ink === 'accent' ? 'var(--color-accent)' : 'var(--color-destructive)';

  if (textOnly) {
    return (
      <span
        className={cn('t-mono-sm', styles.textOnly, className)}
        aria-hidden={decorative ? 'true' : undefined}
        role={decorative ? undefined : 'img'}
        aria-label={decorative ? undefined : label}
      >
        {verb.toUpperCase()} · {dateLine}
      </span>
    );
  }

  const scale = size / 44;
  const outerStroke = 1.5 * scale;
  const innerStroke = 1 * scale;
  const c = size / 2;

  return (
    <svg
      className={cn(styles.mark, animate && styles.animate, className)}
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      fill="none"
      role={decorative ? undefined : 'img'}
      aria-label={decorative ? undefined : label}
      aria-hidden={decorative ? 'true' : undefined}
    >
      <circle
        cx={c}
        cy={c}
        r={(size - outerStroke) / 2}
        stroke={color}
        strokeWidth={outerStroke}
      />
      <circle
        cx={c}
        cy={c}
        r={(size * 0.77 - innerStroke) / 2}
        stroke={color}
        strokeWidth={innerStroke}
        opacity={0.55}
      />
      <text
        x={c}
        y={size * 0.477}
        textAnchor="middle"
        fill={color}
        className={styles.text}
        fontSize={size * 0.115}
      >
        {verb.toUpperCase()}
      </text>
      <text
        x={c}
        y={size * 0.614}
        textAnchor="middle"
        fill={color}
        className={styles.text}
        fontSize={size * 0.115}
      >
        {dateLine}
      </text>
    </svg>
  );
}

/** The product mark: the outer ring alone, no text (§5.1). */
export function PostmarkRing({
  size = 48,
  strokeWidth = 1.5,
  className,
}: {
  size?: number;
  strokeWidth?: number;
  className?: string;
}) {
  return (
    <svg
      className={cn(styles.ring, className)}
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      fill="none"
      aria-hidden="true"
    >
      <circle
        cx={size / 2}
        cy={size / 2}
        r={(size - strokeWidth) / 2}
        stroke="currentColor"
        strokeWidth={strokeWidth}
      />
    </svg>
  );
}
