import { useRef, type CSSProperties } from 'react';
import { localModelNeedsAddress } from '../../lib/desktop';
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

/**
 * C-27 provider choice — `role="radiogroup"` with arrow-key roving focus.
 *
 * Rows, not cards. Five options in a 640px column made a 4+1 mosaic of
 * mismatched heights with a glyph and a radio circle crowding each corner;
 * as rows, each option gets the full width, the glyph sits where a list's
 * leading icon belongs, and the radio on the right is the only selection
 * control in sight.
 */
export function ProviderRadioGroup({
  value,
  onChange,
  found,
}: {
  value: SelectableProvider | null;
  onChange: (id: SelectableProvider) => void;
  /**
   * A runtime answering on this machine, e.g. "Ollama · 1 model". Rendered on
   * the Local row rather than in a note under the list: this is the best
   * outcome the screen has — no key, no account, nothing leaving the Mac — and
   * under five options is where nobody scanning them will see it.
   */
  found?: string;
}) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);

  /*
   * The Local row is offered everywhere, including on a phone, where it means
   * something slightly different: the model is on your Mac rather than under
   * your hand, and its address has to be typed because nothing can guess it.
   * The sub-label says which of the two this device is looking at.
   */
  const remote = localModelNeedsAddress();
  const options = PROVIDER_OPTIONS.map((o) =>
    o.id === 'local' && remote ? { ...o, sub: 'Ollama on your network' } : o,
  );

  function onKeyDown(e: React.KeyboardEvent) {
    // Both axes: visually this is a column, but §8.1 users arrive from either.
    const forward = e.key === 'ArrowRight' || e.key === 'ArrowDown';
    const backward = e.key === 'ArrowLeft' || e.key === 'ArrowUp';
    if (!forward && !backward) return;
    const currentIndex = options.findIndex((o) => o.id === value);
    const base = currentIndex === -1 ? 0 : currentIndex;
    const delta = forward ? 1 : -1;
    const nextIndex = (base + delta + options.length) % options.length;
    const next = options[nextIndex];
    onChange(next.id);
    e.preventDefault();
    refs.current[nextIndex]?.focus();
  }

  return (
    <div
      role="radiogroup"
      aria-label="AI provider"
      className={styles.list}
      onKeyDown={onKeyDown}
    >
      {options.map((opt, i) => {
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
            // Without this the name is computed from contents and runs the
            // pieces together — "AnthropicClaude".
            aria-label={
              found && opt.id === 'local'
                ? `${PROVIDER_LABELS[opt.id]}, ${found}, already running on this machine`
                : `${PROVIDER_LABELS[opt.id]}, ${opt.sub}`
            }
            tabIndex={isTabbable ? 0 : -1}
            className={cn(styles.row, selected && styles.rowSelected)}
            onClick={() => onChange(opt.id)}
          >
            <span
              className={styles.markTile}
              style={{ '--mark-color': opt.markTone } as CSSProperties}
              aria-hidden="true"
            >
              <span className={styles.markSquare} />
            </span>
            <span className={cn('t-sm', styles.rowName)}>{PROVIDER_LABELS[opt.id]}</span>
            <span className={cn('t-mono-sm', styles.rowSub)}>
              {found && opt.id === 'local' ? found : opt.sub}
            </span>
            {found && opt.id === 'local' && (
              <span className={cn('t-xs', styles.foundHere)}>
                <span className={styles.foundDot} aria-hidden="true" />
                running here
              </span>
            )}
            <span
              className={cn(styles.radioDot, selected && styles.radioDotSelected)}
              aria-hidden="true"
            />
          </button>
        );
      })}
    </div>
  );
}
