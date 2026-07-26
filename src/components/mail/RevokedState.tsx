import { Button } from '../primitives/Button';
import { cn } from '../../lib/cn';
import styles from './RevokedState.module.css';

/**
 * §5.5 — "Error — token revoked". Its own state, not a connection error: no
 * "Try again", because retrying cannot possibly work until the user goes back
 * through Google.
 *
 * The spec makes this one lock the whole shell — "the list and reader both show
 * it, and only Settings and this action remain interactive" — so it lives here
 * rather than inside the list column that first rendered it.
 */
export function RevokedState({ onConnectGmail }: { onConnectGmail: () => void }) {
  return (
    <div className={styles.block}>
      <p className="t-lg">Pigeon lost access to your mail.</p>
      <p className={cn('t-sm', styles.body)}>
        Google revoked Pigeon&apos;s permission. Connect your account again to keep using Pigeon.
      </p>
      <Button variant="primary" onClick={onConnectGmail}>
        Connect Gmail
      </Button>
    </div>
  );
}
