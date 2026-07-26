import { useNavigate } from 'react-router-dom';
import { SettingsPage } from '../../components/settings/SettingsPage';
import { Button } from '../../components/primitives/Button';
import { Monogram } from '../../components/primitives/Monogram';
import { Segmented } from '../../components/primitives/Controls';
import { useMail } from '../../store/mail';
import { useSettings, type Appearance } from '../../store/settings';
import { useUi } from '../../store/ui';
import { relativeTime } from '../../lib/format';
import { cn } from '../../lib/cn';
import styles from './AccountSettings.module.css';

const APPEARANCE_OPTIONS: { value: Appearance; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

/** §5.13a Account. */
export function AccountSettings() {
  const account = useMail((s) => s.account);
  const appearance = useSettings((s) => s.appearance);
  const setAppearance = useSettings((s) => s.setAppearance);
  const setOnboarded = useSettings((s) => s.setOnboarded);
  const openDialog = useUi((s) => s.openDialog);
  const navigate = useNavigate();

  // §3.6 / §7.7 — both destructive account actions reset to onboarding.
  function returnToOnboarding() {
    setOnboarded(false);
    navigate('/welcome');
  }

  return (
    <SettingsPage>
      <h1 className="t-xl">Account</h1>

      <div className={styles.row}>
        <Monogram name={account?.name} email={account?.email ?? 'pigeon'} size={28} />
        <div className={styles.info}>
          <div className={cn('t-base', styles.name)}>{account?.name ?? ''}</div>
          <div className={cn('t-sm', styles.email)}>{account?.email ?? ''}</div>
        </div>
        {account && (
          <span className={cn('t-xs', styles.connected)}>
            Connected {relativeTime(account.connectedAt)}
          </span>
        )}
      </div>

      <section className={styles.section}>
        <h2 className={cn('t-sm', styles.sectionLabel)}>Appearance</h2>
        <Segmented
          as="radiogroup"
          label="Appearance"
          value={appearance}
          onChange={setAppearance}
          options={APPEARANCE_OPTIONS}
        />
      </section>

      <section className={cn(styles.section, styles.destructive)}>
        <Button
          variant="secondary-destructive"
          onClick={() =>
            openDialog({
              title: `Disconnect ${account?.email ?? ''}?`,
              body: "Pigeon will stop syncing and you'll be signed out. Your mail stays in Gmail, and your approved and declined senders are kept for 30 days.",
              primaryLabel: 'Disconnect account',
              tone: 'destructive',
              onConfirm: returnToOnboarding,
            })
          }
        >
          Disconnect Google account
        </Button>
        <Button
          variant="secondary"
          onClick={() =>
            openDialog({
              title: 'Sign out of Pigeon?',
              body: "You'll need to sign in with Google again. Nothing changes in your mail.",
              primaryLabel: 'Sign out',
              tone: 'neutral',
              onConfirm: returnToOnboarding,
            })
          }
        >
          Sign out
        </Button>
      </section>
    </SettingsPage>
  );
}
