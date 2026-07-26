import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { OnboardingColumn } from '../../components/onboarding/OnboardingColumn';
import { GoogleSetup } from '../../components/onboarding/GoogleSetup';
import { Button } from '../../components/primitives/Button';
import { PostmarkRing } from '../../components/primitives/Postmark';
import { useMail } from '../../store/mail';
import { AuthError, gmailStatus, signIn } from '../../data/gmail/auth';
import { GmailMailProvider } from '../../data/gmail/gmailProvider';
import styles from './WelcomeRoute.module.css';

/**
 * §3.1 branches 2a/2b. Both come straight off Google's consent screen, so the
 * copy lives with the AuthError that carries it.
 *
 * The screen has three shapes, and which one a user sees depends on what this
 * build can reach:
 *
 *  - **macOS app, client already set up** — "Connect Gmail" opens consent.
 *  - **macOS app, first run** — "Connect Gmail" opens the five-minute setup,
 *    then consent, without the user having to know those are two things.
 *  - **Web build** — real mail needs a client baked in at build time, so
 *    without one the only honest offer is the demo account.
 *
 * The demo is a first-class choice in all three, not a consolation. It is the
 * one path that works in the first ten seconds after a download, and a mail
 * client nobody can look inside is a mail client nobody adopts.
 */
export function WelcomeRoute() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [settingUp, setSettingUp] = useState(false);
  const status = gmailStatus();

  async function enterWith(provider: 'gmail' | 'demo') {
    if (provider === 'gmail') useMail.getState().setProvider(new GmailMailProvider());
    await useMail.getState().loadAccount();
    navigate('/setup/provider');
  }

  /** Consent, then in. Shared by the direct path and the post-setup one. */
  async function connect() {
    setError(null);
    setLoading(true);
    try {
      // A grant already in the Keychain needs no consent screen — asking again
      // would be a second trip through Google for nothing.
      if (!gmailStatus().hasSession) await signIn();
      await enterWith('gmail');
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

  async function handleConnect() {
    if (loading) return;
    if (status.canConnect || status.hasSession) return connect();
    if (status.canSetUp) {
      setSettingUp(true);
      return;
    }
    // Web build with no client of its own: the demo is all there is.
    setError(null);
    setLoading(true);
    try {
      await enterWith('demo');
    } finally {
      setLoading(false);
    }
  }

  async function handleDemo() {
    if (loading) return;
    setLoading(true);
    try {
      await enterWith('demo');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Enter') return;
      const target = e.target as HTMLElement | null;
      // A focused button already handles its own Enter via the click event,
      // and the setup panel has fields of its own that Enter belongs to.
      if (settingUp) return;
      if (target && (target.tagName === 'BUTTON' || target.tagName === 'A')) return;
      void handleConnect();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, settingUp]);

  return (
    <OnboardingColumn width={settingUp ? 620 : 480}>
      <div className={styles.wrap}>
        <PostmarkRing size={48} strokeWidth={1.5} className={styles.mark} />
        <h1 className="t-display-lg">Pigeon</h1>
        <p className={`t-md ink-secondary ${styles.subhead}`}>
          Mail from people you&apos;ve chosen. Everyone else waits at the door.
        </p>

        {settingUp ? (
          <GoogleSetup
            onReady={() => {
              setSettingUp(false);
              void connect();
            }}
            onSkip={handleDemo}
          />
        ) : (
          <>
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
              <Button variant="tertiary" fullWidth onClick={handleDemo} disabled={loading}>
                Try the demo instead
              </Button>
            </div>

            <p className={`t-xs ink-tertiary ${styles.legal}`}>
              Pigeon reads and sends mail on your behalf. It never sends anything you
              haven&apos;t seen.
            </p>
            {!status.canConnect && !status.canSetUp && (
              <p className={`t-xs ink-tertiary ${styles.demoNote}`}>
                This is the web build, which has no Google client of its own, so Connect Gmail
                shows the demo account. The macOS app can connect real mail.
              </p>
            )}
          </>
        )}
      </div>
    </OnboardingColumn>
  );
}
