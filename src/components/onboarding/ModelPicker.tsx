import { useRef, useState } from 'react';
import { localModelNeedsAddress } from '../../lib/desktop';
import { cn } from '../../lib/cn';
import { FIT_LABEL, type Catalog, type CatalogEntry } from '../../ai/catalog';
import { progressLabel, pullModel, type PullProgress } from '../../ai/pull';
import { Button } from '../primitives/Button';
import styles from './ModelPicker.module.css';

export interface ModelPickerProps {
  catalog: Catalog;
  /** Models the user already has that Pigeon does not curate. */
  other: string[];
  selected: string;
  disabled?: boolean;
  onSelect: (name: string) => void;
  /** Where to send the download. Absent disables it. */
  baseUrl?: string;
  /** A model finished downloading — re-list what the endpoint has. */
  onPulled?: (name: string) => void;
}

function sizeLabel(gb: number): string {
  return gb >= 10 ? `${Math.round(gb)} GB` : `${gb.toFixed(1)} GB`;
}

/**
 * Which model to run, ranked for this Mac.
 *
 * The field here used to be a `<select>` of whatever Ollama had pulled, which
 * answers "what do I have" when the question is "what should I use". Someone
 * who installed Ollama last week to try this app has one model in that list
 * and no way to know whether it is the right one.
 *
 * Models too large for the machine are listed and disabled rather than hidden.
 * Being told a 27B model needs more memory than this Mac has is useful;
 * silently not seeing it, and wondering later why Pigeon never mentioned it,
 * is not. Buzz's share-compute picker takes the same position.
 *
 * Curated picks — the recommendation plus the small safe one — sit above the
 * fold, and everything else is behind a toggle.
 */
export function ModelPicker({
  catalog,
  other,
  selected,
  disabled,
  onSelect,
  baseUrl,
  onPulled,
}: ModelPickerProps) {
  const [expanded, setExpanded] = useState(false);

  /*
   * One download at a time, tracked by name. Recommending a model and then
   * leaving someone to find a terminal is recommending nothing — but two
   * concurrent pulls on a laptop is also not a kindness, so starting one while
   * another runs is simply not offered.
   */
  const [pulling, setPulling] = useState<string | null>(null);
  const [progress, setProgress] = useState<PullProgress | null>(null);
  const [pullError, setPullError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);

  function download(name: string) {
    if (!baseUrl || pulling) return;
    const controller = new AbortController();
    abort.current = controller;
    setPulling(name);
    setProgress(null);
    setPullError(null);

    void pullModel(baseUrl, name, setProgress, controller.signal)
      .then(() => {
        setPulling(null);
        setProgress(null);
        // Select it: someone who just waited for a download wanted this model.
        onSelect(name);
        onPulled?.(name);
      })
      .catch((error: unknown) => {
        setPulling(null);
        setProgress(null);
        if (controller.signal.aborted) return;
        setPullError(error instanceof Error ? error.message : 'The download failed.');
      });
  }

  function cancel() {
    abort.current?.abort();
    setPulling(null);
    setProgress(null);
  }

  const curated = catalog.entries.filter((e) => e.curated);
  const advanced = catalog.entries.filter((e) => !e.curated);
  const visible = expanded ? catalog.entries : curated;
  const knowsMachine = catalog.usableGb > 0;

  return (
    <div className={styles.picker}>
      <p className={cn('t-xs', styles.header)}>
        {knowsMachine
          ? `Ranked for this Mac — ${catalog.chip ? `${catalog.chip}, ` : ''}${Math.round(
              catalog.usableGb,
            )} GB usable for a model`
          : /*
             * The fit column needs to know how much memory the model has to
             * live in, and on a phone that is a different machine's memory —
             * unknowable from here, and not this device's business. Pointing
             * at "the macOS app" would be pointing at the machine the model is
             * already running on.
             */
            localModelNeedsAddress()
            ? 'Ranked by size. Whether one fits depends on the machine running it.'
            : 'Ranked by size. The macOS app also says which of these fit this Mac.'}
      </p>

      <ul className={styles.list}>
        {visible.map((entry) => (
          <li key={entry.name}>
            <Row
              entry={entry}
              selected={entry.name === selected}
              disabled={disabled}
              showFit={knowsMachine}
              onSelect={onSelect}
              canDownload={Boolean(baseUrl) && !pulling}
              onDownload={() => download(entry.name)}
              progress={pulling === entry.name ? progress : undefined}
              onCancel={cancel}
              pulling={pulling === entry.name}
            />
          </li>
        ))}
      </ul>

      {pullError && (
        <p className={cn('t-xs', styles.error)} role="status">
          {pullError}
        </p>
      )}

      {advanced.length > 0 && (
        <button
          type="button"
          className={cn('t-xs', styles.toggle)}
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? 'Show fewer' : `${advanced.length} more models`}
        </button>
      )}

      {/*
        A model the user pulled that Pigeon does not curate. Keeping it
        selectable matters more than the tidiness of the list: hiding it would
        mean a picker that silently drops the model somebody was already using.
      */}
      {other.length > 0 && (
        <>
          <p className={cn('t-xs', styles.header, styles.otherHeader)}>
            Also installed, not on Pigeon&apos;s list
          </p>
          <ul className={styles.list}>
            {other.map((name) => (
              <li key={name}>
                <button
                  type="button"
                  disabled={disabled}
                  aria-pressed={name === selected}
                  className={cn(styles.row, name === selected && styles.rowSelected)}
                  onClick={() => onSelect(name)}
                >
                  <span className={cn('t-sm', styles.name)}>{name}</span>
                  <span className={cn('t-xs', styles.installed)}>Installed</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function Row({
  entry,
  selected,
  disabled,
  showFit,
  onSelect,
  canDownload,
  onDownload,
  progress,
  onCancel,
  pulling,
}: {
  entry: CatalogEntry;
  selected: boolean;
  disabled?: boolean;
  showFit: boolean;
  onSelect: (name: string) => void;
  canDownload: boolean;
  onDownload: () => void;
  progress?: PullProgress | null;
  onCancel: () => void;
  pulling: boolean;
}) {
  const tooLarge = entry.fit === 'too-large';
  const blocked = disabled || tooLarge;

  /*
   * A div with a button role, not a `<button>`. The row carries its own
   * controls — Download, Stop — and a button inside a button is invalid HTML
   * that browsers resolve by dropping one of them, usually the inner one.
   */
  return (
    <div
      role="button"
      tabIndex={blocked ? -1 : 0}
      // aria-disabled, not `disabled`: a control nobody can focus is a control
      // whose reason nobody can read, and "why is this greyed out" is exactly
      // the question this row exists to answer.
      aria-disabled={blocked || undefined}
      aria-pressed={selected}
      className={cn(styles.row, selected && styles.rowSelected, tooLarge && styles.rowTooLarge)}
      onClick={() => {
        if (!blocked) onSelect(entry.name);
      }}
      onKeyDown={(e) => {
        if (blocked || (e.key !== 'Enter' && e.key !== ' ')) return;
        e.preventDefault();
        onSelect(entry.name);
      }}
    >
      <span className={styles.top}>
        <span className={cn('t-sm', styles.name)}>{entry.name}</span>
        <span className={cn('t-xs', styles.size)}>{sizeLabel(entry.sizeGb)}</span>
        {entry.recommended && (
          <span className={cn('t-xs', styles.badge)}>Recommended</span>
        )}
        {entry.installed ? (
          <span className={cn('t-xs', styles.installed)}>Installed</span>
        ) : tooLarge ? null : (
          <Button
            variant="tertiary"
            size="xs"
            disabled={!canDownload || pulling}
            onClick={(e) => {
              e.stopPropagation();
              onDownload();
            }}
          >
            Download
          </Button>
        )}
        {showFit && (
          <span className={cn('t-xs', styles.fit, styles[entry.fit])}>
            {FIT_LABEL[entry.fit]}
          </span>
        )}
      </span>
      <span className={cn('t-xs', styles.description)}>
        {tooLarge ? 'Needs more memory than this Mac has.' : entry.description}
      </span>

      {pulling && (
        <span className={styles.progress}>
          <span className={styles.bar}>
            <span
              className={styles.fill}
              style={progress?.fraction != null ? { width: `${progress.fraction * 100}%` } : undefined}
            />
          </span>
          <span className={cn('t-xs', styles.progressText)}>
            {progress ? progressLabel(progress) : 'Starting'}
          </span>
          <span
            role="button"
            tabIndex={0}
            className={cn('t-xs', styles.cancel)}
            onClick={(e) => {
              e.stopPropagation();
              onCancel();
            }}
            onKeyDown={(e) => {
              if (e.key !== 'Enter' && e.key !== ' ') return;
              e.stopPropagation();
              e.preventDefault();
              onCancel();
            }}
          >
            Stop
          </span>
        </span>
      )}
    </div>
  );
}
