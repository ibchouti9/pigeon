import { useRef } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { NavRail } from './NavRail';
import { RevokedState } from '../mail/RevokedState';
import { ShellLayers } from './ShellLayers';
import { useMail } from '../../store/mail';
import { useBreakpoint } from '../../hooks/useBreakpoint';
import { useOnline } from '../../hooks/useOnline';
import { useGlobalShortcuts } from '../../hooks/useGlobalShortcuts';
import { useShellData } from '../../hooks/useShellData';
import { useRouteFocus } from '../../hooks/useRouteFocus';
import { useComposeParam } from '../../hooks/useComposeParam';
import { cn } from '../../lib/cn';
import styles from './AppShell.module.css';

/**
 * §5.0 — the persistent shell: rail 232 · list 380 · reader fluid.
 * The Screener and Settings merge the list and reader columns into one region;
 * those routes render a single child that fills `.region`.
 */
export function AppShell() {
  const bp = useBreakpoint();
  const online = useOnline();
  const revoked = useMail((s) => s.revoked);
  const navigate = useNavigate();
  const inSettings = useLocation().pathname.startsWith('/settings');
  const regionRef = useRef<HTMLDivElement>(null);
  useRouteFocus(regionRef);
  useComposeParam();
  const searchRef = useRef<HTMLInputElement>(null);

  useGlobalShortcuts(searchRef);
  useShellData();

  return (
    <div className={styles.shell}>
      <a className="skip-link" href="#main">
        Skip to mail
      </a>

      {!online && (
        <div className={cn('t-sm', styles.banner)} role="status">
          You're offline. Pigeon is showing the mail it already has.
        </div>
      )}

      <div className={styles.body}>
        <NavRail compact={bp === 'tablet' || bp === 'narrow'} searchRef={searchRef} locked={revoked} />
        <div className={styles.region} id="main" ref={regionRef}>
          {/*
            §5.5 — a revoked token "locks the whole shell: the list and reader
            both show it, and only Settings and this action remain interactive".
            Only the list column was rendering it, so the reader sat beside the
            error saying "Select a thread to read it." and every route stayed
            live. Settings is the one place still worth reaching.
          */}
          {revoked && !inSettings ? (
            <RevokedState onConnectGmail={() => navigate('/settings/account')} />
          ) : (
            <Outlet />
          )}
        </div>
      </div>

      <ShellLayers />
    </div>
  );
}
