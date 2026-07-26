import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { OnboardingColumn } from '../../components/onboarding/OnboardingColumn';
import { Button } from '../../components/primitives/Button';
import { PostmarkRing } from '../../components/primitives/Postmark';
import { useMail } from '../../store/mail';
import { AuthError, googleClientId, signIn } from '../../data/gmail/auth';
import { GmailMailProvider } from '../../data/gmail/gmailProvider';
import styles from './WelcomeRoute.module.css';

/**
 * §3.1 branches 2a/2b. Both come straight off Google's consent screen, so the
 * copy lives with the AuthError that carries it.
 */
export function WelcomeRoute() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hasOAuth = googleClientId() !== null;

  async function handleConnect() {
    if (loading) return;
    setError(null);
    setLoading(true);
    try {
      if (hasOAuth) {
        // §3.1 step 2 — this is the navigation to Google consent. Nothing
        // reaches the Gmail API until it resolves.
        await signIn();
        useMail.getState().setProvider(new GmailMailProvider());
      }
      await useMail.getState().loadAccount();
      navigate('/setup/provider');
    } catch (e) {
      // AuthError already carries §3.1's branch copy; anything else is a
      // network or GIS-loading failure, which reads the same to the user.
      setError(
        e instanceof AuthError
          ? e.message
          : "Pigeon couldn't reach Google. Check your connection and try again.",
      );
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
              {error}
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
        {!hasOAuth && (
          <p className={`t-xs ink-tertiary ${styles.demoNote}`}>
            No Google client is configured, so this connects Pigeon&apos;s demo mail account.
            Add VITE_GOOGLE_CLIENT_ID to .env.local for real mail — the README explains how.
          </p>
        )}
      </div>
    </OnboardingColumn>
  );
}
