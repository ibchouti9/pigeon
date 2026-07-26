import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { OnboardingColumn } from '../../components/onboarding/OnboardingColumn';
import { StepList, type Step, type StepState } from '../../components/onboarding/StepList';
import {
  getSyncProgress,
  retrySync,
  startSync,
  subscribeSync,
} from '../../components/onboarding/syncSession';
import { Button } from '../../components/primitives/Button';
import { ProgressBar } from '../../components/primitives/Feedback';
import { cn } from '../../lib/cn';
import { formatCount } from '../../lib/format';
import type { SyncProgress } from '../../types';
import { useMail } from '../../store/mail';
import { useSettings } from '../../store/settings';
import styles from './SyncRoute.module.css';

const STEP_ORDER: SyncProgress['step'][] = ['connect', 'contacts', 'history', 'senders', 'complete'];

function stepState(index: number, currentIdx: number): StepState {
  if (currentIdx < 0) return 'pending';
  if (index < currentIdx) return 'done';
  if (index === currentIdx) return 'current';
  return 'pending';
}

export function SyncRoute() {
  const navigate = useNavigate();
  const account = useMail((s) => s.account);
  const skippedProvider = useSettings((s) => s.skippedProvider);
  const [progress, setProgress] = useState(getSyncProgress());
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    startSync();
    return subscribeSync(setProgress);
  }, []);

  const total = progress.total;
  const done = progress.done;
  const pct = total ? done / total : 0;
  const complete = progress.step === 'complete';
  const canContinue = !progress.error && (complete || pct >= 0.2);

  const currentIdx = STEP_ORDER.indexOf(progress.step);
  const steps: Step[] = [
    {
      key: 'connect',
      label: `Connected ${account?.email ?? 'your account'}`,
      state: stepState(0, currentIdx),
    },
    { key: 'contacts', label: 'Read your contacts', state: stepState(1, currentIdx) },
    { key: 'history', label: 'Reading your mail history', state: stepState(2, currentIdx) },
    { key: 'senders', label: 'Working out who you know', state: stepState(3, currentIdx) },
  ];

  const counterText =
    total === null ? 'Counting your threads' : `${formatCount(done)} of ${formatCount(total)} threads`;

  async function handleContinue() {
    setChecking(true);
    try {
      const provider = useMail.getState().provider;
      const [inbox, archive] = await Promise.all([
        provider.listThreads('inbox'),
        provider.listThreads('archive'),
      ]);
      const quiet = inbox.length + archive.length < 50;
      navigate(quiet ? '/setup/screener' : '/setup/senders', { state: { quietInbox: quiet } });
    } finally {
      setChecking(false);
    }
  }

  const heading = complete ? 'Your mail is ready.' : 'Setting up your inbox';

  return (
    <OnboardingColumn width={480}>
      <h1 className={cn('t-display-md', styles.heading)}>{heading}</h1>

      {progress.error ? (
        <div className={styles.errorBlock} role="alert">
          <p className="t-sm">
            {`Sync stopped at ${formatCount(done)} of ${formatCount(total ?? 0)} threads. Gmail returned an error. Start sync again — Pigeon will pick up where it stopped.`}
          </p>
          <div className={styles.errorActions}>
            <Button variant="primary" onClick={retrySync}>
              Start sync again
            </Button>
            <a className={cn('t-sm', styles.contactLink)} href="mailto:support@pigeon.mail">
              Contact support
            </a>
          </div>
        </div>
      ) : (
        <>
          <ProgressBar
            value={total === null ? null : done}
            max={total}
            valueText={counterText}
            className={styles.progress}
          />
          <p className={cn('t-mono-md', 'ink-secondary', styles.counter)}>{counterText}</p>

          <hr className={styles.divider} />

          <StepList steps={steps} />

          {skippedProvider && (
            <p className={cn('t-sm', 'ink-tertiary', styles.skippedLine)}>
              The assistant is off. Turn it on any time in Settings → Assistant.
            </p>
          )}

          <Button
            variant="primary"
            fullWidth
            disabled={!canContinue}
            loading={checking}
            onClick={handleContinue}
            className={styles.continueButton}
          >
            Continue
          </Button>
        </>
      )}
    </OnboardingColumn>
  );
}
