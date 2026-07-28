import { useEffect } from 'react';
import { useMail } from '../store/mail';
import { useOnline } from './useOnline';

/**
 * How often to look for mail that arrived while Pigeon was open.
 *
 * The provider holds a listing for 30s (`WINDOW_TTL_MS`), so anything under
 * that is answered from cache and costs nothing — which is what makes the
 * focus and visibility triggers below free. A minute is the interval that
 * actually reaches the server.
 */
const POLL_MS = 60_000;

/**
 * New mail, without reopening the app.
 *
 * The shell fetched the inbox once at mount and nothing ever fetched it again:
 * no timer, no IDLE, no focus listener. Left open all day, Pigeon showed the
 * mail that existed when it started and nothing after it — the one behaviour
 * that disqualifies a mail client outright, and invisible in every test
 * because tests mount, assert and unmount.
 *
 * Pigeon holds no IDLE connection (the Rust engine has a single locked
 * session, so an IDLE would block every other command), which leaves polling.
 * Coming back to the window is the other half: it is when a person expects to
 * see what arrived while they were elsewhere, and the cache makes it cheap.
 */
export function useMailRefresh(): void {
  const refresh = useMail((s) => s.refresh);
  const online = useOnline();

  useEffect(() => {
    // D21 — offline is read-only. A poll against a dead connection produces
    // nothing but errors the banner is already explaining.
    if (!online) return;

    const run = () => {
      // A hidden window is a window nobody is reading. Waking to fetch mail
      // for a tab in the background spends the user's battery and quota on a
      // screen that isn't there; the visibility listener catches them coming
      // back, so nothing is missed by waiting.
      if (document.visibilityState !== 'visible') return;
      void refresh();
    };

    const timer = setInterval(run, POLL_MS);
    document.addEventListener('visibilitychange', run);
    window.addEventListener('focus', run);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', run);
      window.removeEventListener('focus', run);
    };
  }, [online, refresh]);
}
