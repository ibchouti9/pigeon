import { useEffect, useRef, useState } from 'react';
import type { SyncProgress } from '../../types';
import { NavLink, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
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
/*
 * The rail's sync bar runs on the steps, not on a thread count. `total` is the
 * size of the mailbox — every conversation in the inbox, which the engine counts
 * in full — while setting up lists one window of it, so `done / total` would sit
 * near zero through a sync that is nearly finished.
 */
const SYNC_STEPS: SyncProgress['step'][] = [
  'connect',
  'contacts',
  'history',
  'senders',
  'complete',
];

export function NavRail({ compact, searchRef, locked = false }: NavRailProps) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [searchParams] = useSearchParams();

  /*
   * §2.2 spells the search URL `/search?q=…&held=0|1`, and the rail's field was
   * neither reading it nor preserving it. Landing on one — a reload, a
   * bookmark, the back button — left the field empty beside a full page of
   * results, and because every keystroke navigates, typing one character
   * replaced the query rather than editing it and dropped `held` with it: the
   * "Also search held mail" scope silently turned itself off.
   */
  // `startsWith`, not equality: opening a result routes to `/search/t/:id` and
  // carries the query with it. The user is still inside their search, so the
  // field has to keep showing it.
  const query = pathname.startsWith('/search') ? (searchParams.get('q') ?? '') : '';

  function search(next: string) {
    if (!next) return navigate('/search');
    const params = new URLSearchParams(searchParams);
    params.set('q', next);
    navigate(`/search?${params}`);
  }
  const account = useMail((s) => s.account);
  const unread = useUnreadCount();
  const heldCount = useHeldCount();
  const openCompose = useCompose((s) => s.open);
  const online = useOnline();

  const [sync, setSync] = useState(getSyncProgress);
  useEffect(() => subscribeSync(setSync), []);
  const syncing = sync.step !== 'complete' && !sync.error && sync.total !== null;
  const syncPct = Math.round(((SYNC_STEPS.indexOf(sync.step) + 1) / SYNC_STEPS.length) * 100);
  const localRef = useRef<HTMLInputElement>(null);
  const inputRef = searchRef ?? localRef;

  const items: Item[] = [
    { to: '/inbox', icon: 'inbox', label: 'Inbox', count: unread, countVariant: 'plain', countNoun: 'unread' },
    { to: '/screener', icon: 'screener-ring', label: 'Screener', count: heldCount, countVariant: 'ring', countNoun: 'waiting' },
    { to: '/ledger', icon: 'ledger', label: 'Ledger' },
    { to: '/archive', icon: 'archive', label: 'Archive' },
    { to: '/sent', icon: 'sent', label: 'Sent' },
    { to: '/drafts', icon: 'drafts', label: 'Drafts' },
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
              §3.1 3a — a user who leaves O3 early leaves sync running. Without
              this the rest of it finished invisibly, and a half-loaded inbox
              looked like the whole of their mail.
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
            data-search-field="rail"
            onKeyDown={(e) => {
              if (e.key !== 'Escape') return;
              /*
               * §8.1's Esc is a layer stack — one press closes one layer.
               * Leaving the field was one, and the event then carried on to
               * the window handler, which minimized the composer as well: one
               * press, two layers. The list columns already stop exactly this
               * (MailListColumn, BulkReview); the rail did not.
               */
              e.currentTarget.blur();
              e.stopPropagation();
              e.preventDefault();
            }}
            value={query}
            onChange={(e) => search(e.currentTarget.value)}
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
