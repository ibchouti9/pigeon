import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { TabBar } from './TabBar';
import { RevokedState } from '../mail/RevokedState';
import { ShellLayers } from './ShellLayers';
import { useMail } from '../../store/mail';
import { useCompose } from '../../store/compose';
import { useOnline } from '../../hooks/useOnline';
import { useShellData } from '../../hooks/useShellData';
import { useComposeParam } from '../../hooks/useComposeParam';
import { useKeyboardOpen } from '../../hooks/useKeyboardOpen';
import { Icon } from '../primitives/Icon';
import { cn } from '../../lib/cn';
import styles from './MobileShell.module.css';

/*
 * Compose floats over the mail places and nowhere else. Today, the Ledger and
 * the Screener are all screens about mail that already exists, and a button
 * for writing new mail sitting over a Screener card answers a question the
 * screen is not asking.
 */
const MAIL_PLACES = ['/inbox', '/archive', '/sent', '/drafts', '/search'];

/**
 * The shell below 720px: the screen, a tab bar, and nothing else.
 *
 * A separate component rather than a wide media query over `AppShell`, because
 * the difference is not a width — it is a navigation model. The desktop shell
 * is a rail beside two panes that are both always on screen; the phone is a
 * stack, one screen deep at a time, with the destinations along the bottom
 * edge. Expressed as breakpoints in one file, every layout rule would have had
 * to say which of the two models it belonged to, and the answer is different
 * for almost every one of them.
 *
 * What the two shells share, they share as code: `useShellData` loads the same
 * lists, `ShellLayers` mounts the same overlays, and every screen inside the
 * region is the same component the desktop renders.
 */
export function MobileShell() {
  const online = useOnline();
  const revoked = useMail((s) => s.revoked);
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const openCompose = useCompose((s) => s.open);
  const hasDraft = useCompose((s) => Boolean(s.draft));
  const typing = useKeyboardOpen();

  useComposeParam();
  useShellData();

  /*
   * No `useRouteFocus` and no `useGlobalShortcuts`.
   *
   * The first moves focus to the new screen's heading on every route change,
   * which is how a keyboard user knows they have arrived somewhere. On a phone
   * that same call raises the software keyboard's focus ring on a heading
   * nobody asked about, and VoiceOver already announces a screen change.
   *
   * The second is §8.1's single-key map — `c`, `e`, `g i` — which needs a
   * keyboard to press. A phone has none, and the one case where it would have
   * something to do is the one where it does harm: a hardware keyboard paired
   * to a phone, typing into a field the webview has scrolled out from under
   * itself, where `isTypingTarget` can no longer tell that focus is in a text
   * field and `e` archives the thread behind it.
   */

  const inSettings = pathname.startsWith('/settings');

  /*
   * And not while a thread is open. At that width the reader has replaced the
   * list, the conversation's own reply affordance sits at the foot of it, and
   * a button for writing to somebody else was landing on top of it.
   */
  const inThread = pathname.includes('/t/');
  const showCompose =
    MAIL_PLACES.some((p) => pathname.startsWith(p)) &&
    !inThread &&
    !hasDraft &&
    online &&
    !typing &&
    !revoked;

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

      <div className={styles.region} id="main">
        {/* §5.5 — a revoked token locks the shell; Settings stays reachable. */}
        {revoked && !inSettings ? (
          <RevokedState onConnectGmail={() => navigate('/settings/account')} />
        ) : (
          <Outlet />
        )}
      </div>

      {showCompose && (
        <button
          type="button"
          className={styles.compose}
          aria-label="Compose"
          onClick={() => openCompose()}
        >
          <Icon name="compose" size={24} />
        </button>
      )}

      {/*
        Gone while the keyboard is up. It is behind the keys either way, so
        nothing here is reachable — but left mounted it shows through the
        accessory bar as a row of ghost labels, and it holds a tab bar's worth
        of height that the field being typed into could be using instead.
      */}
      {!typing && <TabBar locked={revoked} />}
      <ShellLayers />
    </div>
  );
}
