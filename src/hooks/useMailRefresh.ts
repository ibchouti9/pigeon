import { useEffect } from 'react';
import { useMail } from '../store/mail';
import { useOnline } from './useOnline';
import { isDesktop, listen } from '../lib/desktop';

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
 * The same interval, once IDLE is doing the work.
 *
 * The poll does not go away when the watcher exists, it slows down. IDLE is a
 * socket, and sockets die quietly: a laptop lid, a network change, a Gmail
 * hiccup between the watcher's reconnect attempts. The watcher recovers from
 * all of those on its own, and until it does this is the floor under how stale
 * the inbox can get. Five minutes is cheap and is not what anyone will
 * actually be relying on.
 */
const IDLE_POLL_MS = 5 * 60_000;

/**
 * `watch::INBOX_CHANGED` in `src-tauri/src/mail/watch.rs`. Two declarations of
 * one string across a language boundary: if one changes, change the other.
 */
const INBOX_CHANGED = 'mail://inbox-changed';

/**
 * New mail, without reopening the app.
 *
 * The shell fetched the inbox once at mount and nothing ever fetched it again:
 * no timer, no IDLE, no focus listener. Left open all day, Pigeon showed the
 * mail that existed when it started and nothing after it — the one behaviour
 * that disqualifies a mail client outright, and invisible in every test
 * because tests mount, assert and unmount.
 *
 * The native build holds an IDLE connection now (`mail::watch`) and says when
 * the mailbox changed, so there the poll is a safety net rather than the
 * mechanism — a socket can die between the watcher noticing and reconnecting,
 * and five minutes is the floor under how stale that can leave the list. The
 * web build has no engine and no socket, so it keeps the minute.
 *
 * Coming back to the window is the other half of both: it is when a person
 * expects to see what arrived while they were elsewhere, and the cache makes
 * it cheap.
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

    const timer = setInterval(run, isDesktop() ? IDLE_POLL_MS : POLL_MS);
    document.addEventListener('visibilitychange', run);
    window.addEventListener('focus', run);

    /*
     * The watcher's event, and deliberately not gated on `visibilityState`
     * the way the timer is. A hidden window skips the poll because polling a
     * screen nobody is reading is waste; this is not a poll. Gmail has already
     * told us something changed, the answer costs one cached listing, and the
     * unread count it produces is what the dock badge and the notification are
     * built from — all of which are for exactly the case where the window is
     * *not* the thing in front of you.
     */
    let stopListening: (() => void) | undefined;
    let cancelled = false;
    void listen(INBOX_CHANGED, () => void refresh()).then((unlisten) => {
      if (cancelled) unlisten();
      else stopListening = unlisten;
    });

    return () => {
      cancelled = true;
      stopListening?.();
      clearInterval(timer);
      document.removeEventListener('visibilitychange', run);
      window.removeEventListener('focus', run);
    };
  }, [online, refresh]);
}
