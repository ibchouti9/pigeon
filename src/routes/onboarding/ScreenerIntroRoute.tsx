import { plural } from '../../lib/format';
import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { CardStackMini } from '../../components/onboarding/CardStackMini';
import { OnboardingColumn } from '../../components/onboarding/OnboardingColumn';
import { Button } from '../../components/primitives/Button';
import { cn } from '../../lib/cn';
import { useMail } from '../../store/mail';
import { useSettings } from '../../store/settings';
import { useToasts } from '../../store/toast';
import styles from './ScreenerIntroRoute.module.css';

interface NavState {
  quietInbox?: boolean;
}

export function ScreenerIntroRoute() {
  const navigate = useNavigate();
  const location = useLocation();
  const quietInbox = Boolean((location.state as NavState | null)?.quietInbox);
  const [pending, setPending] = useState<'inbox' | 'skip' | null>(null);

  async function finish(which: 'inbox' | 'skip') {
    if (pending) return;
    setPending(which);

    let n = useMail.getState().held.length;
    if (useMail.getState().status.held !== 'ready') {
      try {
        n = (await useMail.getState().provider.listHeld()).length;
      } catch {
        n = useMail.getState().held.length;
      }
    }

    useSettings.getState().setOnboarded(true);
    navigate('/inbox');
    useToasts.getState().push({
      message: `Pigeon is holding ${plural(n, 'sender')} for you.`,
      tone: 'confirm',
      duration: 8000,
      action: { label: 'Open Screener', run: () => navigate('/screener') },
    });
  }

  return (
    <OnboardingColumn width={480}>
      <div className={styles.wrap}>
        <div className={styles.stack}>
          <CardStackMini />
        </div>

        <h1 className={cn('t-display-md', styles.heading)}>Strangers wait at the door</h1>

        <div className={cn('t-md', 'ink-secondary', styles.paras)}>
          <p>
            Mail from someone new never lands in your inbox. It waits in the Screener until you
            decide.
          </p>
          <p>
            Approve someone and their mail — this one and everything after — goes to your inbox.
            Decline and you never see them again. You can change your mind any time in Settings.
          </p>
          {quietInbox && (
            <p>Your inbox is quiet, so almost everything new will start in the Screener.</p>
          )}
        </div>

        <div className={styles.actions}>
          <Button
            variant="primary"
            loading={pending === 'inbox'}
            disabled={pending !== null && pending !== 'inbox'}
            onClick={() => void finish('inbox')}
          >
            Go to inbox
          </Button>
          <Button
            variant="tertiary"
            loading={pending === 'skip'}
            disabled={pending !== null && pending !== 'skip'}
            onClick={() => void finish('skip')}
          >
            Skip
          </Button>
        </div>
      </div>
    </OnboardingColumn>
  );
}
