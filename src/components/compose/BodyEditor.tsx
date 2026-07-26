import { useEffect, useRef, type ReactNode } from 'react';
import { cn } from '../../lib/cn';
import styles from './BodyEditor.module.css';

const PLACEHOLDER = /\[confirm:[^\]]*\]/gi;

/** Splits the body so `[confirm: …]` spans can be painted behind the textarea. */
function highlight(body: string): ReactNode[] {
  const parts: ReactNode[] = [];
  let last = 0;
  let key = 0;

  PLACEHOLDER.lastIndex = 0;
  let match = PLACEHOLDER.exec(body);
  while (match) {
    if (match.index > last) parts.push(body.slice(last, match.index));
    parts.push(
      <span key={key++} className={styles.placeholder}>
        {match[0]}
      </span>,
    );
    last = match.index + match[0].length;
    match = PLACEHOLDER.exec(body);
  }
  parts.push(body.slice(last));
  // A trailing newline is not laid out by the underlay unless something follows.
  parts.push('\n');
  return parts;
}

export interface BodyEditorProps {
  value: string;
  onChange: (next: string) => void;
  /** True while the body still belongs to Pigeon — AI ink on the AI tint. */
  drafted: boolean;
  placeholder?: string;
  disabled?: boolean;
  minHeight?: number;
  maxHeight?: number;
  ariaLabel: string;
  ariaDescribedBy?: string;
  /** §5.12 — the body is aria-busy while Pigeon is writing into it. */
  busy?: boolean;
  className?: string;
  textareaRef?: React.RefObject<HTMLTextAreaElement | null>;
  onKeyDown?: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
}

export function BodyEditor({
  value,
  onChange,
  drafted,
  placeholder,
  disabled,
  minHeight = 200,
  maxHeight = 480,
  ariaLabel,
  ariaDescribedBy,
  busy,
  className,
  textareaRef,
  onKeyDown,
}: BodyEditorProps) {
  const localRef = useRef<HTMLTextAreaElement>(null);
  const ref = textareaRef ?? localRef;
  const underlayRef = useRef<HTMLDivElement>(null);

  // Grow to fit, then scroll (§5.12: min 200px, grows to 480px then scrolls).
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(maxHeight, Math.max(minHeight, el.scrollHeight))}px`;
  }, [value, minHeight, maxHeight, ref]);

  return (
    <div className={cn(styles.wrap, drafted && styles.drafted, className)}>
      <div
        ref={underlayRef}
        className={styles.underlay}
        aria-hidden="true"
        style={{ minHeight }}
      >
        {highlight(value)}
      </div>
      <textarea
        ref={ref}
        className={styles.input}
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-describedby={ariaDescribedBy}
        aria-busy={busy || undefined}
        spellCheck
        style={{ minHeight }}
        onKeyDown={onKeyDown}
        onScroll={(e) => {
          if (underlayRef.current) {
            underlayRef.current.scrollTop = e.currentTarget.scrollTop;
          }
        }}
        onChange={(e) => onChange(e.currentTarget.value)}
      />
    </div>
  );
}
