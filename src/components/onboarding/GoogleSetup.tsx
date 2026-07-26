import { useEffect, useState } from 'react';
import { cn } from '../../lib/cn';
import { onFileDrop, openExternal } from '../../lib/desktop';
import {
  SETUP_STEPS,
  forgetCredentials,
  looksLikeCredentials,
  pickCredentials,
  setCredentialsFromPath,
  setCredentialsFromText,
} from '../../data/gmail/setup';
import { Button } from '../primitives/Button';
import { Icon } from '../primitives/Icon';
import styles from './GoogleSetup.module.css';

/**
 * The five-minute Google setup, done inside Pigeon rather than out of a README.
 *
 * Three things here are doing the real work, and each replaces a specific way
 * the old instructions failed:
 *
 *  - **Deep links.** The console renames its own navigation about once a year,
 *    so "APIs & Services → Credentials" stops being true while a URL keeps
 *    working.
 *  - **The file, not the strings.** Google's own Download JSON button gives a
 *    file holding both values. Dropping it beats copying a client ID and a
 *    secret out of a table by hand, which is where transcription errors —
 *    a trailing space, the wrong column — used to come from.
 *  - **Desktop app, not Web application.** Installed-app clients need no
 *    registered redirect URI, so the single most common failure in a
 *    bring-your-own setup, an origin that doesn't match, cannot happen at all.
 */
export interface GoogleSetupProps {
  /** Runs once credentials are stored — the caller then opens consent. */
  onReady: () => void;
  /** Rendered as the way out, when there is one. */
  onSkip?: () => void;
  /** True when a client is already stored, so the panel offers to replace it. */
  configured?: boolean;
}

type Phase = 'idle' | 'saving';

export function GoogleSetup({ onReady, onSkip, configured = false }: GoogleSetupProps) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string | null>(null);
  const [pasting, setPasting] = useState(false);
  const [pasted, setPasted] = useState('');
  /** Set while a file is over the window, so the drop target says so. */
  const [over, setOver] = useState(false);

  async function accept(run: () => Promise<unknown>) {
    setPhase('saving');
    setError(null);
    try {
      const result = await run();
      // `pickCredentials` resolves false when the user closed the picker —
      // not an error, and not a reason to move on either.
      if (result === false) {
        setPhase('idle');
        return;
      }
      setPhase('idle');
      onReady();
    } catch (e) {
      // Every message Rust returns here is already written for a person: which
      // file they picked, and which one they wanted.
      setError(e instanceof Error ? e.message : String(e));
      setPhase('idle');
    }
  }

  /*
   * Dropping the file anywhere on the window counts. Restricting it to a
   * rectangle looks tidier and is worse: the file arrives from Downloads, the
   * user is already dragging, and a drop that lands two pixels outside a zone
   * silently does nothing.
   */
  useEffect(() => {
    return onFileDrop((paths) => {
      setOver(false);
      const file = paths.find(looksLikeCredentials);
      if (!file) {
        setError('That file is not the JSON Google gave you — look for one ending in .json.');
        return;
      }
      void accept(() => setCredentialsFromPath(file));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className={styles.wrap}>
      <p className={cn('t-sm', styles.why)}>
        Google only lets an app read mail on your behalf once it has passed a paid security
        review. Pigeon hasn&apos;t, so instead you register Pigeon with Google yourself. It
        takes about five minutes, once, and nothing leaves this machine.
      </p>

      <ol className={styles.steps}>
        {SETUP_STEPS.map((step, i) => (
          <li key={step.url} className={styles.step}>
            <span className={cn('t-mono-sm', styles.number)} aria-hidden="true">
              {i + 1}
            </span>
            <div className={styles.stepBody}>
              <p className={cn('t-base', styles.stepTitle)}>
                {step.title}
                {step.optional && (
                  <span className={cn('t-xs', styles.optional)}> — optional</span>
                )}
              </p>
              <p className={cn('t-sm', styles.stepDetail)}>{step.detail}</p>
            </div>
            <button
              type="button"
              className={cn('t-sm', styles.open)}
              onClick={() => void openExternal(step.url)}
            >
              Open
              <Icon name="external-link" size={16} aria-hidden="true" />
            </button>
          </li>
        ))}
      </ol>

      <div
        className={cn(styles.drop, over && styles.dropOver)}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
      >
        <p className={cn('t-base', styles.dropTitle)}>Drop that JSON file here</p>
        <p className={cn('t-sm', styles.dropHint)}>
          Or{' '}
          <button
            type="button"
            className={cn('t-sm', styles.link)}
            onClick={() => void accept(pickCredentials)}
          >
            choose it
          </button>{' '}
          from Downloads
          {!pasting && (
            <>
              , or{' '}
              <button
                type="button"
                className={cn('t-sm', styles.link)}
                onClick={() => setPasting(true)}
              >
                paste its contents
              </button>
            </>
          )}
          .
        </p>
      </div>

      {pasting && (
        <div className={styles.pasteBlock}>
          <label htmlFor="google-json" className="visually-hidden">
            Google client JSON
          </label>
          <textarea
            id="google-json"
            className={cn('t-mono-sm', styles.paste)}
            rows={4}
            spellCheck={false}
            autoComplete="off"
            placeholder={'{"installed":{"client_id":"…'}
            value={pasted}
            onChange={(e) => setPasted(e.target.value)}
          />
          <Button
            variant="secondary"
            size="xs"
            disabled={pasted.trim().length === 0 || phase === 'saving'}
            onClick={() => void accept(() => setCredentialsFromText(pasted))}
          >
            Use this
          </Button>
        </div>
      )}

      {error && (
        <p className={cn('t-sm', styles.error)} role="alert">
          {error}
        </p>
      )}

      <div className={styles.actions}>
        {configured && (
          <Button
            variant="tertiary"
            size="xs"
            onClick={() =>
              void forgetCredentials().then(() =>
                setError('Pigeon has forgotten that client. Set one up again above.'),
              )
            }
          >
            Forget this client
          </Button>
        )}
        {onSkip && (
          <Button variant="tertiary" onClick={onSkip}>
            Use the demo account instead
          </Button>
        )}
      </div>
    </div>
  );
}
