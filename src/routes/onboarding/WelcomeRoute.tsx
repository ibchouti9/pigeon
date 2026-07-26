import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { OnboardingColumn } from '../../components/onboarding/OnboardingColumn';
import { Button } from '../../components/primitives/Button';
import { PostmarkRing } from '../../components/primitives/Postmark';
import { useMail } from '../../store/mail';
import styles from './WelcomeRoute.module.css';

/**
 * §3.1 branches 2a/2b. There is no real Google OAuth client configured yet
 * (see the module note in the task brief), so these can't be triggered from
 * a real consent screen today — but the render path is wired end to end so
 * the UI is complete and ready the moment OAuth lands.
 */
type ConnectError = 'denied' | 'partial' | null;

const ERROR_COPY: Record<Exclude<ConnectError, null>, string> = {
  denied:
    "Pigeon didn't get access to your mail. Google needs permission to read and send on your behalf for Pigeon to work. Try connecting again.",
  partial:
    'Pigeon needs all four permissions to sort your mail. Connect again and leave the checkboxes ticked.',
};

export function WelcomeRoute() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ConnectError>(null);

  async function handleConnect() {
    if (loading) return;
    setError(null);
    setLoading(true);
    try {
      // No OAuth client is configured yet — connect the built-in demo
      // account so onboarding is fully walkable today.
      await useMail.getState().loadAccount();
      navigate('/setup/provider');
    } catch {
      setError('denied');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Enter') return;
      const target = e.target as HTMLElement | null;
      // A focused button already handles its own Enter via the click event.
      if (target && (target.tagName === 'BUTTON' || target.tagName === 'A')) return;
      void handleConnect();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);

  return (
    <OnboardingColumn width={480}>
      <div className={styles.wrap}>
        <PostmarkRing size={48} strokeWidth={1.5} className={styles.mark} />
        <h1 className="t-display-lg">Pigeon</h1>
        <p className={`t-md ink-secondary ${styles.subhead}`}>
          Mail from people you&apos;ve chosen. Everyone else waits at the door.
        </p>

        <div className={styles.actions}>
          {error && (
            <div className={`t-sm ${styles.errorBlock}`} role="alert">
              {ERROR_COPY[error]}
            </div>
          )}
          <Button
            variant="primary"
            fullWidth
            loading={loading}
            onClick={handleConnect}
            style={{ height: 44 }}
          >
            Connect Gmail
          </Button>
        </div>

        <p className={`t-xs ink-tertiary ${styles.legal}`}>
          Pigeon reads and sends mail on your behalf. It never sends anything you haven&apos;t
          seen.
        </p>
        <p className={`t-xs ink-tertiary ${styles.demoNote}`}>
          Running on Pigeon&apos;s demo mail account. Connect Google in Settings once you&apos;ve
          added an OAuth client.
        </p>
      </div>
    </OnboardingColumn>
  );
}
