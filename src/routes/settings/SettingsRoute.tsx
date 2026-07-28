import { useRef } from 'react';
import { NavLink, Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { ConfirmDialog } from '../../components/settings/ConfirmDialog';
import { useBreakpoint } from '../../hooks/useBreakpoint';
import { Icon } from '../../components/primitives/Icon';
import { cn } from '../../lib/cn';
import styles from './SettingsRoute.module.css';

const NAV_ITEMS = [
  { to: '/settings/account', label: 'Account' },
  { to: '/settings/senders', label: 'Senders' },
  { to: '/settings/assistant', label: 'Assistant' },
  { to: '/settings/about', label: 'About' },
];

/**
 * What `/settings` itself is.
 *
 * On a desktop it is nothing — the sub-nav is always on screen, so landing on
 * the bare path means landing on Account. On a phone the sub-nav is the screen,
 * and redirecting past it would leave the four sections reachable only by
 * typing their URLs.
 */
export function SettingsIndex() {
  const phone = useBreakpoint() === 'phone';
  if (!phone) return <Navigate to="/settings/account" replace />;
  return (
    <nav className={styles.sectionList} aria-label="Settings">
      <h1 className={cn('t-display-sm', styles.sectionTitle)}>Settings</h1>
      {NAV_ITEMS.map((item) => (
        <NavLink key={item.to} to={item.to} className={cn('t-base', styles.sectionRow)}>
          <span className={styles.sectionLabel}>{item.label}</span>
          <Icon name="chevron-left" size={20} className={styles.sectionChevron} />
        </NavLink>
      ))}
    </nav>
  );
}

/**
 * §5.13 — Settings occupies the merged list+reader region, like the
 * Screener. A 200px sub-nav sits left (Account · Senders · Assistant ·
 * About), content fills the rest.
 */
export function SettingsRoute() {
  const navRef = useRef<HTMLElement>(null);
  const phone = useBreakpoint() === 'phone';
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const atIndex = pathname === '/settings' || pathname === '/settings/';

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

  /*
   * A phone gets a stack instead of a split: `/settings` is the list of
   * sections, and each section is a screen you came from somewhere. Rendering
   * the 200px sub-nav beside the content at 375px left 175px for a settings
   * form, which put "Marc Ferrum" and "Connected 13 minutes ago" on top of one
   * another and ran the Disconnect button off the right of the screen.
   */
  if (phone) {
    return (
      <div className={styles.stack}>
        {!atIndex && (
          <header className={styles.stackHeader}>
            <button
              type="button"
              className={cn('t-sm', styles.stackBack)}
              onClick={() => navigate('/settings')}
            >
              <Icon name="chevron-left" size={16} />
              Settings
            </button>
          </header>
        )}
        <div className={styles.content}>
          <Outlet />
        </div>
        <ConfirmDialog />
      </div>
    );
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
