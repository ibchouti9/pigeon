import { useEffect, useRef, useState } from 'react';
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

/** §3.1 3c — below this, onboarding skips O4 entirely. */
const QUIET_ACCOUNT_THREADS = 50;

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
  const complete = progress.step === 'complete';
  const currentIdx = STEP_ORDER.indexOf(progress.step);

  /*
   * §5.2b's progress is the steps, not a thread count.
   *
   * It used to be `done / total` over a walk that fetched every conversation in
   * the mailbox — which is where "Continue at 20%" came from, because on a real
   * account the other 80% took long enough to need an escape hatch. Setting up
   * now reads a sample of sent mail and lists one window of rows: bounded work,
   * a few seconds, and no position inside it that means anything to anybody. The
   * escape hatch survives as "you may leave once the mail step has started",
   * which is what it was for.
   */
  const canContinue = !progress.error && (complete || currentIdx >= 2);
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

  /*
   * D34 wants the real size of the mailbox on this screen, and the real size is
   * what the engine counts in full — not the window it listed. Saying "200 of
   * 40,000 threads" would report the window as progress through the mailbox and
   * then declare the mail ready at half a percent.
   */
  const counterText =
    total === null
      ? 'Reading your mail'
      : `${formatCount(total)} ${total === 1 ? 'conversation' : 'conversations'} in your inbox`;

  // §8.4 — "Progress updates are announced at most once every 10 seconds via a
  // role="status" region". The counter itself ticks several times a second;
  // putting a live region on that would read the whole sync aloud, number by
  // number. Completion is announced immediately whatever the clock says.
  const [announced, setAnnounced] = useState('');
  const lastAnnouncedAt = useRef(0);

  useEffect(() => {
    const now = performance.now();
    if (!complete && now - lastAnnouncedAt.current < 10_000) return;
    lastAnnouncedAt.current = now;
    setAnnounced(complete ? 'Your mail is ready.' : counterText);
  }, [counterText, complete]);

  async function handleContinue() {
    setChecking(true);
    try {
      const provider = useMail.getState().provider;

      /*
       * §3.1 3c — "the account has fewer than 50 *total* threads". That is what
       * sync counted, not what Pigeon has walked: the thread walk stops at
       * 2,000 a place, and on the demo account the seed holds 22 threads while
       * the sync it reports is 11,908. Measuring the walked lists made every
       * demo run look like a quiet account, so O4 was skipped and 342 known
       * senders were never offered — a whole screen the demo could not reach.
       * Falls back to the lists only while the count is still unknown.
       */
      const walked = async () =>
        (
          await Promise.all([provider.listThreads('inbox'), provider.listThreads('archive')])
        ).reduce((n, list) => n + list.length, 0);

      /*
       * Nothing here may strand the user on O3. These calls are a refinement —
       * which screen comes next, and whether contacts are pre-approved — and a
       * provider that throws used to leave Continue un-spun and inert with no
       * error state and no way forward. Treating a failure as "not quiet" sends
       * them to O4, which has its own error state for a sender list that won't
       * load, and where nothing has been decided on their behalf.
       */
      const quiet = await (total !== null
        ? Promise.resolve(total < QUIET_ACCOUNT_THREADS)
        : walked().then((n) => n < QUIET_ACCOUNT_THREADS)
      ).catch(() => false);

      // §3.1 3c — a quiet account skips O4, but the branch still says "known
      // senders are seeded from Contacts only". Skipping the screen used to
      // skip the seeding with it, so every contact started life in the
      // Screener and the user had to approve people they already knew.
      if (quiet) {
        await (async () => {
          const known = await provider.getKnownSenders();
          const fromContacts = known.filter((s) => s.knownReason === 'contact');
          if (fromContacts.length) {
            await provider.approveKnownSenders(fromContacts.map((s) => s.id));
          }
        })().catch(() => {
          // The seeding is an optimisation; O5 works without it and those
          // senders simply wait in the Screener, where the user can see them.
        });
      }

      navigate(quiet ? '/setup/screener' : '/setup/senders', { state: { quietInbox: quiet } });
    } finally {
      setChecking(false);
    }
  }

  const heading = complete ? 'Your mail is ready.' : 'Setting up your inbox';

  return (
    <OnboardingColumn width={480}>
      <h1 className={cn('t-display-md', styles.heading)}>{heading}</h1>

      <p className="visually-hidden" role="status">
        {announced}
      </p>

      {progress.error ? (
        <div className={styles.errorBlock} role="alert">
          <p className="t-sm">
            Pigeon couldn't finish setting up. Gmail returned an error. Nothing has
            been changed in your mailbox — start again.
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
            value={currentIdx < 0 ? null : currentIdx + 1}
            max={STEP_ORDER.length}
            valueText={counterText}
            className={styles.progress}
          />
          <p className={cn('t-mono-md', 'ink-secondary', styles.counter)}>{counterText}</p>

          <hr className={styles.divider} />

          {/*
            §5.2b — at completion Continue "becomes the only focusable element".
            It already is: nothing else on this screen takes focus. Hiding the
            finished step list would only cost a screen reader the summary of
            what just happened.
          */}
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
