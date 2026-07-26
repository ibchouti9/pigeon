import { useEffect, useRef } from 'react';
import { Outlet } from 'react-router-dom';
import { NavRail } from './NavRail';
import { ToastStack } from './ToastStack';
import { ShortcutsDialog } from './ShortcutsDialog';
import { ComposeDock } from '../compose/ComposeDock';
import { HeldMessageSheet } from '../screener/HeldMessageSheet';
import { useMail } from '../../store/mail';
import { useBreakpoint } from '../../hooks/useBreakpoint';
import { useOnline } from '../../hooks/useOnline';
import { useGlobalShortcuts } from '../../hooks/useGlobalShortcuts';
import { toast } from '../../store/toast';
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
  const searchRef = useRef<HTMLInputElement>(null);
  const wasOffline = useRef(false);

  const loadAccount = useMail((s) => s.loadAccount);
  const loadThreads = useMail((s) => s.loadThreads);
  const loadHeld = useMail((s) => s.loadHeld);
  const loadSenders = useMail((s) => s.loadSenders);
  const loadContacts = useMail((s) => s.loadContacts);

  useGlobalShortcuts(searchRef);

  useEffect(() => {
    void loadAccount();
    void loadThreads('inbox');
    void loadHeld();
    void loadSenders();
    void loadContacts();
  }, [loadAccount, loadThreads, loadHeld, loadSenders, loadContacts]);

  useEffect(() => {
    if (!online) {
      wasOffline.current = true;
    } else if (wasOffline.current) {
      wasOffline.current = false;
      toast.confirm('Back online.');
    }
  }, [online]);

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
        <NavRail compact={bp === 'tablet' || bp === 'narrow'} searchRef={searchRef} />
        <div className={styles.region} id="main">
          <Outlet />
        </div>
      </div>

      <div className={cn('t-md', styles.tooNarrow)}>
        Pigeon needs a wider window. Open Pigeon on a screen at least 720 pixels wide.
      </div>

      <ComposeDock />
      {/*
        A global layer, like the dock and the toasts. It used to be mounted by
        the Screener alone, so a held result in Search opened nothing — and
        because an open sheet blocks every single-key shortcut, the whole app's
        keyboard went dead until the user pressed Esc on a sheet they could not
        see.
      */}
      <HeldMessageSheet />
      <ShortcutsDialog />
      <ToastStack />
    </div>
  );
}
