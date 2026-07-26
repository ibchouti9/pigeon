import { useRef, type CSSProperties } from 'react';
import { cn } from '../../lib/cn';
import { PROVIDER_LABELS } from '../../store/settings';
import styles from './ProviderCard.module.css';

/**
 * The cards O2 (§5.2) offers. `demo` is not in the spec: it returns canned
 * assistant output so every AI surface can be run and reviewed without a key,
 * and it says so on the card. Choosing nothing still exercises C-28.
 */
export type SelectableProvider = 'anthropic' | 'openai' | 'google' | 'local' | 'demo';

interface ProviderOption {
  id: SelectableProvider;
  sub: string;
  /** A token from the monogram ramp — Pigeon does not reproduce provider logos. */
  markTone: string;
}

const PROVIDER_OPTIONS: ProviderOption[] = [
  { id: 'anthropic', sub: 'Claude', markTone: 'var(--monogram-3)' },
  { id: 'openai', sub: 'GPT', markTone: 'var(--monogram-4)' },
  { id: 'google', sub: 'Gemini', markTone: 'var(--monogram-5)' },
  { id: 'local', sub: 'Ollama · LM Studio', markTone: 'var(--monogram-6)' },
  { id: 'demo', sub: 'Canned · no key', markTone: 'var(--monogram-2)' },
];

/** C-27 provider row — `role="radiogroup"` with arrow-key roving focus. */
export function ProviderRadioGroup({
  value,
  onChange,
}: {
  value: SelectableProvider | null;
  onChange: (id: SelectableProvider) => void;
}) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const currentIndex = PROVIDER_OPTIONS.findIndex((o) => o.id === value);
    const base = currentIndex === -1 ? 0 : currentIndex;
    const delta = e.key === 'ArrowRight' ? 1 : -1;
    const nextIndex = (base + delta + PROVIDER_OPTIONS.length) % PROVIDER_OPTIONS.length;
    const next = PROVIDER_OPTIONS[nextIndex];
    onChange(next.id);
    e.preventDefault();
    refs.current[nextIndex]?.focus();
  }

  return (
    <div
      role="radiogroup"
      aria-label="AI provider"
      className={styles.grid}
      onKeyDown={onKeyDown}
    >
      {PROVIDER_OPTIONS.map((opt, i) => {
        const selected = opt.id === value;
        const isTabbable = selected || (value === null && i === 0);
        return (
          <button
            key={opt.id}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            // Without this the name is computed from contents and runs the two
            // lines together — "AnthropicClaude".
            aria-label={`${PROVIDER_LABELS[opt.id]}, ${opt.sub}`}
            tabIndex={isTabbable ? 0 : -1}
            className={cn(styles.card, selected && styles.cardSelected)}
            onClick={() => onChange(opt.id)}
          >
            <span className={styles.cardTop}>
              <span
                className={styles.markTile}
                style={{ '--mark-color': opt.markTone } as CSSProperties}
                aria-hidden="true"
              >
                <span className={styles.markSquare} />
              </span>
              <span
                className={cn(styles.radioDot, selected && styles.radioDotSelected)}
                aria-hidden="true"
              />
            </span>
            <span className={cn('t-sm', styles.cardName)}>{PROVIDER_LABELS[opt.id]}</span>
            <span className={cn('t-mono-sm', styles.cardSub)}>{opt.sub}</span>
          </button>
        );
      })}
    </div>
  );
}
