import { useEffect, useRef, useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useMail, useHeldCount, useUnreadCount } from '../../store/mail';
import { useCompose } from '../../store/compose';
import { getSyncProgress, subscribeSync } from '../onboarding/syncSession';
import { useOnline } from '../../hooks/useOnline';
import { Badge } from '../primitives/Controls';
import { Button } from '../primitives/Button';
import { Icon, type IconName } from '../primitives/Icon';
import { Monogram } from '../primitives/Monogram';
import { cn } from '../../lib/cn';
import { formatCount } from '../../lib/format';
import styles from './NavRail.module.css';

interface NavRailProps {
  /** Tablet below 1080px: icons only, labels become title + aria-label. */
  compact: boolean;
  /** The search field lives in the list column header when compact. */
  searchRef?: React.RefObject<HTMLInputElement | null>;
  /**
   * §5.5's revoked state locks the shell — "only Settings and this action
   * remain interactive". The mail destinations and Compose go quiet; the
   * account link stays, because it leads into Settings.
   */
  locked?: boolean;
}

interface Item {
  to: string;
  icon: IconName;
  label: string;
  count?: number;
  countVariant?: 'plain' | 'ring';
  countNoun?: string;
}

/**
 * §5.0 — the rail never changes contents. The same four items and the search
 * field are present on every screen of the app shell.
 */
export function NavRail({ compact, searchRef, locked = false }: NavRailProps) {
  const navigate = useNavigate();
  const account = useMail((s) => s.account);
  const unread = useUnreadCount();
  const heldCount = useHeldCount();
  const openCompose = useCompose((s) => s.open);
  const online = useOnline();

  const [sync, setSync] = useState(getSyncProgress);
  useEffect(() => subscribeSync(setSync), []);
  const syncing = sync.step !== 'complete' && !sync.error && sync.total !== null;
  const syncPct = sync.total ? Math.round((sync.done / sync.total) * 100) : 0;
  const localRef = useRef<HTMLInputElement>(null);
  const inputRef = searchRef ?? localRef;

  const items: Item[] = [
    { to: '/inbox', icon: 'inbox', label: 'Inbox', count: unread, countVariant: 'plain', countNoun: 'unread' },
    { to: '/screener', icon: 'screener-ring', label: 'Screener', count: heldCount, countVariant: 'ring', countNoun: 'waiting' },
    { to: '/archive', icon: 'archive', label: 'Archive' },
  ];

  return (
    <nav
      className={cn(styles.rail, compact && styles.compact)}
      aria-label="Mail"
      data-testid="nav-rail"
    >
      <NavLink
        to="/settings/account"
        className={styles.account}
        aria-label={account ? `Account, ${account.name}, ${account.email}` : 'Account'}
      >
        <Monogram name={account?.name} email={account?.email ?? 'pigeon'} size={28} />
        {!compact && (
          <span className={styles.accountText}>
            <span className={cn('t-base', 'truncate', styles.accountName)}>
              {account?.name ?? 'Loading'}
            </span>
            <span className={cn('t-xs', 'truncate', styles.accountEmail)}>
              {account?.email ?? ''}
            </span>
            {/*
              §3.1 3a — a user who hits Continue at 20% leaves sync running.
              Without this the rest of it finished invisibly, and a half-loaded
              inbox looked like the whole of their mail.
            */}
            {syncing && (
              <span
                className={styles.syncLine}
                role="progressbar"
                aria-label="Still syncing your mail"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={syncPct}
              >
                <span className={styles.syncFill} style={{ width: `${syncPct}%` }} />
              </span>
            )}
          </span>
        )}
      </NavLink>

      {compact ? (
        <Button
          variant="icon"
          size="md"
          aria-label="Search mail"
          title="Search mail"
          onClick={() => navigate('/search')}
        >
          <Icon name="search" size={20} />
        </Button>
      ) : (
        <div className={styles.search}>
          <Icon name="search" size={16} className={styles.searchIcon} />
          <input
            ref={inputRef}
            type="search"
            className={cn('t-base', styles.searchInput)}
            placeholder="Search mail"
            aria-label="Search mail"
            data-search-field="true"
            onKeyDown={(e) => {
              if (e.key === 'Escape') e.currentTarget.blur();
            }}
            onChange={(e) => {
              const q = e.currentTarget.value;
              navigate(q ? `/search?q=${encodeURIComponent(q)}` : '/search');
            }}
          />
        </div>
      )}

      <div className={styles.nav}>
        {items.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            title={compact ? item.label : undefined}
            aria-disabled={locked || undefined}
            onClick={(e) => {
              if (locked) e.preventDefault();
            }}
            aria-label={
              item.count
                ? `${item.label}, ${formatCount(item.count)} ${item.countNoun}`
                : item.label
            }
            className={({ isActive }) =>
              cn('t-base', styles.item, isActive && styles.itemSelected)
            }
          >
            <Icon name={item.icon} size={20} className={styles.itemIcon} />
            {!compact && <span className={styles.itemLabel}>{item.label}</span>}
            {!compact && (
              <Badge value={item.count ?? 0} variant={item.countVariant} className={styles.badge} />
            )}
            {compact && item.count ? <span className={styles.dot} aria-hidden="true" /> : null}
          </NavLink>
        ))}
      </div>

      {/*
        §5.4 — offline disables the archive and compose controls. aria-disabled
        rather than `disabled` so the control keeps its place in the tab order
        and a screen reader can still find and explain it.
      */}
      {compact ? (
        <Button
          variant="primary"
          size="md"
          className={styles.compose}
          aria-label="Compose"
          title="Compose"
          aria-disabled={!online || locked || undefined}
          onClick={() => {
            if (online && !locked) openCompose();
          }}
        >
          <Icon name="compose" size={20} />
        </Button>
      ) : (
        <Button
          variant="primary"
          fullWidth
          className={styles.compose}
          aria-disabled={!online || locked || undefined}
          onClick={() => {
            if (online && !locked) openCompose();
          }}
        >
          Compose
        </Button>
      )}

      <div className={styles.spacer} />
      <div className={styles.divider} />
      <div className={cn(styles.nav, styles.footer)}>
        <NavLink
          to="/settings"
          title={compact ? 'Settings' : undefined}
          aria-label="Settings"
          className={({ isActive }) => cn('t-base', styles.item, isActive && styles.itemSelected)}
        >
          <Icon name="settings" size={20} className={styles.itemIcon} />
          {!compact && <span className={styles.itemLabel}>Settings</span>}
        </NavLink>
      </div>
    </nav>
  );
}
