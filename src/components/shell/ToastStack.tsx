import { useEffect, useRef, useState } from 'react';
import { useToasts, type Toast } from '../../store/toast';
import { Icon } from '../primitives/Icon';
import { cn } from '../../lib/cn';
import styles from './ToastStack.module.css';

/** C-11 Toast. Never receives focus; the timer pauses on hover and focus. */
function ToastItem({ toast }: { toast: Toast }) {
  const dismiss = useToasts((s) => s.dismiss);
  const [paused, setPaused] = useState(false);
  const remaining = useRef(toast.duration);
  const startedAt = useRef(Date.now());

  useEffect(() => {
    if (toast.duration === null || paused) return;
    startedAt.current = Date.now();
    const ms = remaining.current ?? toast.duration;
    const timer = setTimeout(() => dismiss(toast.id), ms);
    return () => {
      clearTimeout(timer);
      if (remaining.current !== null) {
        remaining.current = Math.max(0, remaining.current - (Date.now() - startedAt.current));
      }
    };
  }, [toast.id, toast.duration, paused, dismiss]);

  const pause = () => setPaused(true);
  const resume = () => setPaused(false);

  return (
    <div
      className={cn(styles.toast, toast.tone === 'error' ? styles.error : styles.confirm)}
      onMouseEnter={pause}
      onMouseLeave={resume}
      onFocus={pause}
      onBlur={resume}
    >
      <span className={cn('t-sm', styles.message)}>{toast.message}</span>
      {toast.action && (
        <button
          type="button"
          className={cn('t-sm', styles.action)}
          onClick={() => {
            dismiss(toast.id);
            void toast.action?.run();
          }}
        >
          {toast.action.label}
        </button>
      )}
      {toast.tone === 'error' && (
        <button
          type="button"
          className={styles.close}
          aria-label="Close"
          onClick={() => dismiss(toast.id)}
        >
          <Icon name="close" size={16} />
        </button>
      )}
    </div>
  );
}

/**
 * Two permanently mounted regions so an error is never queued behind a
 * confirmation (§8.4).
 */
export function ToastStack() {
  const toasts = useToasts((s) => s.toasts);
  const confirms = toasts.filter((t) => t.tone === 'confirm');
  const errors = toasts.filter((t) => t.tone === 'error');

  return (
    <div className={styles.region}>
      <div role="status" aria-live="polite" aria-atomic="true">
        {confirms.map((t) => (
          <ToastItem key={t.id} toast={t} />
        ))}
      </div>
      <div role="alert" aria-live="assertive">
        {errors.map((t) => (
          <ToastItem key={t.id} toast={t} />
        ))}
      </div>
    </div>
  );
}
