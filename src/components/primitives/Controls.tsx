import { useRef, type ReactNode } from 'react';
import { cn } from '../../lib/cn';
import { formatCount } from '../../lib/format';
import { Icon } from './Icon';
import styles from './Controls.module.css';

/* -------------------------------------------------------------------------- */
/* C-16 Segmented control                                                      */
/* -------------------------------------------------------------------------- */

export interface SegmentedProps<T extends string> {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  /** `tablist` when it switches views, `radiogroup` when it sets a value. */
  as?: 'tablist' | 'radiogroup';
  label: string;
  className?: string;
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  as = 'tablist',
  label,
  className,
}: SegmentedProps<T>) {
  const ref = useRef<HTMLDivElement>(null);

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const index = options.findIndex((o) => o.value === value);
    const next = e.key === 'ArrowRight' ? index + 1 : index - 1;
    const target = options[(next + options.length) % options.length];
    onChange(target.value);
    e.preventDefault();
    requestAnimationFrame(() => {
      ref.current
        ?.querySelectorAll<HTMLButtonElement>('button')
        [options.indexOf(target)]?.focus();
    });
  }

  return (
    <div
      ref={ref}
      role={as}
      aria-label={label}
      className={cn(styles.segmented, className)}
      onKeyDown={onKeyDown}
    >
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role={as === 'tablist' ? 'tab' : 'radio'}
            aria-selected={as === 'tablist' ? selected : undefined}
            aria-checked={as === 'radiogroup' ? selected : undefined}
            tabIndex={selected ? 0 : -1}
            className={cn('t-sm', styles.segment, selected && styles.segmentSelected)}
            onClick={() => onChange(o.value)}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* C-17 Tabs                                                                   */
/* -------------------------------------------------------------------------- */

export interface TabsProps<T extends string> {
  tabs: { value: T; label: string; panelId: string }[];
  value: T;
  onChange: (value: T) => void;
  label: string;
  children?: ReactNode;
  className?: string;
}

export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
  label,
  children,
  className,
}: TabsProps<T>) {
  function onKeyDown(e: React.KeyboardEvent) {
    const index = tabs.findIndex((t) => t.value === value);
    let next = index;
    if (e.key === 'ArrowRight') next = index + 1;
    else if (e.key === 'ArrowLeft') next = index - 1;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = tabs.length - 1;
    else return;
    onChange(tabs[(next + tabs.length) % tabs.length].value);
    e.preventDefault();
  }

  return (
    <div role="tablist" aria-label={label} className={cn(styles.tablist, className)} onKeyDown={onKeyDown}>
      {tabs.map((t) => {
        const selected = t.value === value;
        return (
          <button
            key={t.value}
            type="button"
            role="tab"
            id={`tab-${t.value}`}
            aria-selected={selected}
            aria-controls={t.panelId}
            tabIndex={selected ? 0 : -1}
            className={cn('t-base', styles.tab, selected && styles.tabSelected)}
            onClick={() => onChange(t.value)}
          >
            {t.label}
          </button>
        );
      })}
      {children}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* C-18 Chip                                                                   */
/* -------------------------------------------------------------------------- */

export interface ChipProps {
  kind: 'filter' | 'recipient' | 'confirm-placeholder' | 'tone';
  label: string;
  count?: number;
  selected?: boolean;
  invalid?: boolean;
  onRemove?: () => void;
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
}

export function Chip({
  kind,
  label,
  count,
  selected,
  invalid,
  onRemove,
  onClick,
  disabled,
  className,
}: ChipProps) {
  const kindClass = {
    filter: styles.chipFilter,
    tone: styles.chipTone,
    recipient: styles.chipRecipient,
    'confirm-placeholder': styles.chipConfirm,
  }[kind];

  const text = count === undefined ? label : `${label} (${formatCount(count)})`;
  const classes = cn(
    't-xs',
    styles.chip,
    kindClass,
    selected && styles.chipSelected,
    invalid && styles.chipInvalid,
    className,
  );

  const content = (
    <>
      {text}
      {onRemove && (
        <span
          role="button"
          tabIndex={-1}
          aria-label={`Remove ${label}`}
          className={styles.chipRemove}
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
        >
          <Icon name="close" size={16} />
        </span>
      )}
    </>
  );

  if (onClick) {
    return (
      <button
        type="button"
        className={classes}
        aria-pressed={selected}
        disabled={disabled}
        onClick={onClick}
      >
        {content}
      </button>
    );
  }

  return (
    <span className={classes} aria-invalid={invalid || undefined}>
      {content}
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* C-4 Badge — hidden entirely at 0, never renders a zero.                     */
/* -------------------------------------------------------------------------- */

export function Badge({
  value,
  variant = 'plain',
  className,
}: {
  value: number;
  variant?: 'plain' | 'ring';
  className?: string;
}) {
  if (!value) return null;
  /*
   * §6 C-4 puts "values above 99 render 99+" on the `ring` line, and the reason
   * is in the geometry: the ring is a fixed 24px circle. The plain variant is
   * free-width text the spec asks for *tabular figures* on, which only matters
   * for lining up multi-digit numbers — so it shows the count it has.
   */
  const text = variant === 'ring' && value > 99 ? '99+' : formatCount(value);
  return (
    <span
      aria-hidden="true"
      className={cn(
        't-mono-sm',
        variant === 'ring' ? styles.badgeRing : styles.badgePlain,
        className,
      )}
    >
      {text}
    </span>
  );
}
