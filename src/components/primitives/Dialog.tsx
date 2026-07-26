import { useEffect, useId, useRef, type ReactNode } from 'react';
import { cn } from '../../lib/cn';
import styles from './Dialog.module.css';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  /** Rendered right-aligned, secondary first (§C-12). */
  actions?: ReactNode;
  /** Element that receives focus on open — the Cancel action, never the destructive one. */
  initialFocusRef?: React.RefObject<HTMLElement | null>;
  labelledBy?: string;
  describedBy?: string;
  wide?: boolean;
  className?: string;
}

/**
 * C-12 Dialog. `role="dialog" aria-modal="true"`, focus trapped, Esc closes and
 * returns focus to the trigger, scrim click closes (both dialogs are
 * non-destructive to cancel).
 */
export function Dialog({
  open,
  onClose,
  title,
  children,
  actions,
  initialFocusRef,
  wide,
  className,
}: DialogProps) {
  const ref = useRef<HTMLDivElement>(null);
  const returnFocusTo = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const bodyId = useId();

  useEffect(() => {
    if (!open) return;
    returnFocusTo.current = document.activeElement as HTMLElement | null;

    const target =
      initialFocusRef?.current ??
      ref.current?.querySelector<HTMLElement>(FOCUSABLE) ??
      ref.current;
    target?.focus();

    return () => {
      returnFocusTo.current?.focus?.();
    };
  }, [open, initialFocusRef]);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Tab' || !ref.current) return;
      const items = Array.from(ref.current.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        last.focus();
        e.preventDefault();
      } else if (!e.shiftKey && document.activeElement === last) {
        first.focus();
        e.preventDefault();
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open]);

  if (!open) return null;

  return (
    <div
      className={styles.scrim}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        className={cn(styles.dialog, wide && styles.wide, className)}
        tabIndex={-1}
      >
        <h2 id={titleId} className={cn('t-xl', styles.title)}>
          {title}
        </h2>
        <div id={bodyId} className={cn('t-base', styles.body)}>
          {children}
        </div>
        {actions && <div className={styles.actions}>{actions}</div>}
      </div>
    </div>
  );
}
