import { NavLink, useLocation } from 'react-router-dom';
import { useHeldCount, useUnreadCount } from '../../store/mail';
import { Icon, type IconName } from '../primitives/Icon';
import { cn } from '../../lib/cn';
import { formatCount } from '../../lib/format';
import styles from './TabBar.module.css';

interface Tab {
  to: string;
  icon: IconName;
  label: string;
  /** Matches child paths too, so a thread keeps its tab lit. */
  match?: (pathname: string) => boolean;
}

/**
 * The phone's navigation, in place of §5.0's rail.
 *
 * The rail carries eight destinations and a phone's tab bar holds five before
 * the labels start abbreviating, so the split is by how often a destination is
 * the reason you opened the app. Today, the Inbox, the Screener and the Ledger
 * are; the Archive, Sent, Drafts and Settings are places you go looking for
 * something, which is what More is for.
 *
 * Search and Compose are deliberately not tabs. Search is a verb — it belongs
 * in the bar above the list it filters — and Compose is the one action worth a
 * button that floats over the content rather than a fifth of the bottom edge.
 */
const TABS: Tab[] = [
  { to: '/brief', icon: 'today', label: 'Today' },
  { to: '/inbox', icon: 'inbox', label: 'Inbox' },
  { to: '/screener', icon: 'screener-ring', label: 'Screener' },
  { to: '/ledger', icon: 'ledger', label: 'Ledger' },
  {
    to: '/more',
    icon: 'more',
    label: 'More',
    // The four destinations behind More, plus Settings, all light it: arriving
    // in the Archive from a link and seeing no tab selected reads as being
    // nowhere.
    match: (p) =>
      ['/more', '/archive', '/sent', '/drafts', '/settings', '/search'].some((r) =>
        p.startsWith(r),
      ),
  },
];

export function TabBar({ locked = false }: { locked?: boolean }) {
  const { pathname } = useLocation();
  const unread = useUnreadCount();
  const held = useHeldCount();

  const counts: Record<string, { value: number; noun: string }> = {
    '/inbox': { value: unread, noun: 'unread' },
    '/screener': { value: held, noun: 'waiting' },
  };

  return (
    <nav className={styles.bar} aria-label="Mail" data-testid="tab-bar">
      {TABS.map((tab) => {
        const count = counts[tab.to];
        /*
         * §5.5's revoked state locks the shell, and "only Settings and this
         * action remain interactive". Settings lives behind More on a phone,
         * so locking all five tabs left the user with exactly one way out —
         * the Connect Gmail button on the screen in front of them — and no way
         * to reach the account they might want to disconnect instead. The
         * rail's own footer link stays live for the same reason.
         */
        const tabLocked = locked && tab.to !== '/more';
        return (
          <NavLink
            key={tab.to}
            to={tab.to}
            aria-disabled={tabLocked || undefined}
            onClick={(e) => {
              if (tabLocked) e.preventDefault();
            }}
            aria-label={
              count?.value ? `${tab.label}, ${formatCount(count.value)} ${count.noun}` : tab.label
            }
            className={({ isActive }) =>
              cn(styles.tab, (isActive || tab.match?.(pathname)) && styles.tabSelected)
            }
          >
            <span className={styles.iconWrap}>
              <Icon name={tab.icon} size={24} />
              {/*
                A dot, not the number. The count is on the row you are about to
                open and in the label a screen reader announces; a two-digit
                pill on a 24px icon at the bottom of a phone is decoration that
                costs legibility.
              */}
              {count?.value ? <span className={styles.dot} aria-hidden="true" /> : null}
            </span>
            <span className={cn('t-xs', styles.label)}>{tab.label}</span>
          </NavLink>
        );
      })}
    </nav>
  );
}
