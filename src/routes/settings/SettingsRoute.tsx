import { useRef } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { ConfirmDialog } from '../../components/settings/ConfirmDialog';
import { cn } from '../../lib/cn';
import styles from './SettingsRoute.module.css';

const NAV_ITEMS = [
  { to: '/settings/account', label: 'Account' },
  { to: '/settings/senders', label: 'Senders' },
  { to: '/settings/assistant', label: 'Assistant' },
  { to: '/settings/about', label: 'About' },
];

/**
 * §5.13 — Settings occupies the merged list+reader region, like the
 * Screener. A 200px sub-nav sits left (Account · Senders · Assistant ·
 * About), content fills the rest.
 */
export function SettingsRoute() {
  const navRef = useRef<HTMLElement>(null);

  function onNavKeyDown(e: React.KeyboardEvent) {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    const el = navRef.current;
    if (!el) return;
    const links = Array.from(el.querySelectorAll<HTMLAnchorElement>('a'));
    const index = links.findIndex((a) => a === document.activeElement);
    if (index === -1) return;
    const next = e.key === 'ArrowDown' ? index + 1 : index - 1;
    const target = links[(next + links.length) % links.length];
    target?.focus();
    e.preventDefault();
  }

  return (
    <div className={styles.wrap}>
      <nav
        ref={navRef}
        className={styles.subnav}
        aria-label="Settings"
        onKeyDown={onNavKeyDown}
      >
        {NAV_ITEMS.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              cn('t-base', styles.navItem, isActive && styles.navItemSelected)
            }
          >
            {item.label}
          </NavLink>
        ))}
      </nav>
      <div className={styles.content}>
        <Outlet />
      </div>
      <ConfirmDialog />
    </div>
  );
}
