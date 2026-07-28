import { NavLink, useNavigate } from 'react-router-dom';
import { useMail } from '../store/mail';
import { useUi } from '../store/ui';
import { Icon, type IconName } from '../components/primitives/Icon';
import { Monogram } from '../components/primitives/Monogram';
import { cn } from '../lib/cn';
import styles from './MoreRoute.module.css';

interface Row {
  to: string;
  icon: IconName;
  label: string;
}

/**
 * The phone's fifth tab: everything the rail carries that the tab bar cannot.
 *
 * The rail has eight destinations and the bar holds five, so the four that
 * lost — the Archive, Sent, Drafts and Settings — are the four you go to
 * looking for something specific rather than to see what has happened. They
 * are a list, and a list of places is a screen, not a menu that appears over
 * one: it gets a URL, a back gesture, and a tab that stays lit while you are
 * inside it.
 */
const GROUPS: Row[][] = [
  [
    { to: '/archive', icon: 'archive', label: 'Archive' },
    { to: '/sent', icon: 'sent', label: 'Sent' },
    { to: '/drafts', icon: 'drafts', label: 'Drafts' },
  ],
  [{ to: '/search', icon: 'search', label: 'Search mail' }],
  [{ to: '/settings', icon: 'settings', label: 'Settings' }],
];

export function MoreRoute() {
  const account = useMail((s) => s.account);
  const setAgentOpen = useUi((s) => s.setAgentOpen);
  const navigate = useNavigate();

  return (
    <div className={styles.screen}>
      <header className={styles.header}>
        <h1 className={cn('t-display-sm', styles.title)}>More</h1>
      </header>

      <div className={styles.scroll}>
        <button
          type="button"
          className={styles.account}
          onClick={() => navigate('/settings/account')}
        >
          <Monogram name={account?.name} email={account?.email ?? 'pigeon'} size={40} />
          <span className={styles.accountText}>
            <span className={cn('t-base', 'truncate', styles.accountName)}>
              {account?.name ?? 'Loading'}
            </span>
            <span className={cn('t-sm', 'truncate', styles.accountEmail)}>
              {account?.email ?? ''}
            </span>
          </span>
          <Icon name="chevron-left" size={20} className={styles.chevron} />
        </button>

        {/*
          The assistant is an action, not a destination — it docks over
          whatever is on screen — so it is a button in a list of links. It sits
          alone above the places for the same reason it sits above Compose in
          the rail: it is the thing that does work for you.
        */}
        <div className={styles.group}>
          <button type="button" className={styles.row} onClick={() => setAgentOpen(true)}>
            <Icon name="sparkle" size={20} className={styles.rowIcon} />
            <span className={cn('t-base', styles.rowLabel)}>Assistant</span>
            <Icon name="chevron-left" size={20} className={styles.chevron} />
          </button>
        </div>

        {GROUPS.map((group, i) => (
          <div key={i} className={styles.group}>
            {group.map((row) => (
              <NavLink key={row.to} to={row.to} className={styles.row}>
                <Icon name={row.icon} size={20} className={styles.rowIcon} />
                <span className={cn('t-base', styles.rowLabel)}>{row.label}</span>
                <Icon name="chevron-left" size={20} className={styles.chevron} />
              </NavLink>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
