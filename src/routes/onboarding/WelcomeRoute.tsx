import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { OnboardingColumn } from '../../components/onboarding/OnboardingColumn';
import { Button } from '../../components/primitives/Button';
import { Input } from '../../components/primitives/Field';
import { PostmarkRing } from '../../components/primitives/Postmark';
import { useMail } from '../../store/mail';
import { openExternal } from '../../lib/desktop';
import {
  APP_PASSWORD_URL,
  canConnectMail,
  connectGmail,
  mailConnected,
} from '../../data/imap/connect';
import { ImapMailProvider } from '../../data/imap/imapProvider';
import { MockMailProvider } from '../../data/mock/mockProvider';
import styles from './WelcomeRoute.module.css';

/**
 * §5.1 O1 — Welcome / Connect Gmail.
 *
 * Connecting is an email address and an app password. The password takes one
 * visit to one Google page — the "Get one" link opens it in the user's real
 * browser, where they are already signed in — and Rust verifies the pair with
 * a real IMAP LOGIN before storing anything, so every failure surfaces here,
 * in words, before onboarding moves an inch (§3.1's branches).
 *
 * The demo is a first-class choice, not a consolation. It is the one path
 * that works in the first ten seconds after a download, and on the web build
 * — which has no Keychain and no sockets — it is the only offer made.
 */
export function WelcomeRoute() {
  const navigate = useNavigate();
  const desktop = canConnectMail();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function enterWith(provider: 'gmail' | 'demo') {
    useMail
      .getState()
      .setProvider(provider === 'gmail' ? new ImapMailProvider() : new MockMailProvider());
    await useMail.getState().loadAccount();
    /*
     * Straight to the mail. O2 used to sit here, so the second thing anyone
     * saw was a provider picker — before a single message, with an imperative
     * heading and its only way past a tertiary button beside a disabled
     * primary. People judge a mail app by its mail; the assistant is offered
     * from the inbox once there is something for it to be useful about.
     */
    navigate('/setup/sync');
  }

  async function handleConnect(event?: React.FormEvent) {
    event?.preventDefault();
    if (loading) return;
    setError(null);
    setLoading(true);
    try {
      // A stored password that still works needs no second form-filling.
      if (!mailConnected()) await connectGmail(email.trim(), password);
      await enterWith('gmail');
    } catch (e) {
      // Rust's refusals are §3.1's branch copy: wrong-password, ordinary-
      // Google-password, IMAP-disabled each arrive distinctly worded.
      setError(e instanceof Error ? e.message : String(e));
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

  const connected = mailConnected();

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

          {desktop && !connected && (
            <form className={styles.form} onSubmit={handleConnect}>
              <Input
                label="Gmail address"
                type="email"
                autoComplete="username"
                spellCheck={false}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@gmail.com"
              />
              <Input
                label="App password"
                type="password"
                mono
                autoComplete="off"
                spellCheck={false}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="16 characters"
                helperText="From your Google account — two-step verification has to be on."
              />
              <p className={`t-sm ${styles.getOne}`}>
                Don&apos;t have one?{' '}
                <button
                  type="button"
                  className={`t-sm ${styles.link}`}
                  onClick={() => void openExternal(APP_PASSWORD_URL)}
                >
                  Get an app password
                </button>{' '}
                — it takes about a minute.
              </p>
              <Button
                type="submit"
                variant="primary"
                fullWidth
                loading={loading}
                style={{ height: 44 }}
              >
                Connect Gmail
              </Button>
            </form>
          )}

          {desktop && connected && (
            <Button
              variant="primary"
              fullWidth
              loading={loading}
              onClick={() => void handleConnect()}
              style={{ height: 44 }}
            >
              Connect Gmail
            </Button>
          )}

          <Button variant="tertiary" fullWidth onClick={handleDemo} disabled={loading}>
            Try the demo instead
          </Button>
        </div>

        <p className={`t-xs ink-tertiary ${styles.legal}`}>
          Pigeon reads and sends mail on your behalf. It never sends anything you haven&apos;t
          seen.{desktop && ' The password stays in your Mac’s Keychain and goes only to Gmail.'}
        </p>
        {!desktop && (
          <p className={`t-xs ink-tertiary ${styles.demoNote}`}>
            This is the web build, which can&apos;t hold mail credentials, so it shows the
            demo account. The macOS app connects real Gmail.
          </p>
        )}
      </div>
    </OnboardingColumn>
  );
}
