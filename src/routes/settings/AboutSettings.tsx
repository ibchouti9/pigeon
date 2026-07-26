import { SettingsPage } from '../../components/settings/SettingsPage';
import { Icon } from '../../components/primitives/Icon';
import { cn } from '../../lib/cn';
import styles from './AboutSettings.module.css';

/**
 * package.json's "version" field, hardcoded here — this route can't add
 * `resolveJsonModule` to tsconfig.app.json (a shared file outside this
 * agent's scope). Keep in sync with package.json manually.
 */
/** Injected by Vite from package.json at build time. */
const PIGEON_VERSION = __APP_VERSION__;
const REPO_URL = 'https://github.com/pigeon-mail/pigeon';

export function AboutSettings() {
  return (
    <SettingsPage>
      <h1 className="t-xl">About</h1>
      <div className={styles.rows}>
        <div className={styles.row}>
          <span className={cn('t-sm', styles.label)}>Version</span>
          <span className="t-mono-sm">{PIGEON_VERSION}</span>
        </div>
        <div className={styles.row}>
          <span className={cn('t-sm', styles.label)}>Licence</span>
          <span className="t-mono-sm">MIT</span>
        </div>
        <div className={styles.row}>
          <span className={cn('t-sm', styles.label)}>Source</span>
          <a className={cn('t-sm', styles.link)} href={REPO_URL} target="_blank" rel="noreferrer">
            {REPO_URL.replace('https://', '')}
            <Icon name="external-link" size={16} />
          </a>
        </div>
      </div>
    </SettingsPage>
  );
}
