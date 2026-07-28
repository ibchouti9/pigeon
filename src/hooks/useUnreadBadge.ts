import { useEffect, useRef } from 'react';
import { useUnreadCount } from '../store/mail';
import { invoke, isDesktop } from '../lib/desktop';

/**
 * Keeps the app icon's badge on the unread Inbox count.
 *
 * Inbox only. The Screener's count is the other number the rail shows and it
 * deliberately stays off the icon: a badge claims something needs you, and the
 * Screener's whole argument is that mail from someone you have not chosen does
 * not — it waits until you go and look.
 */
export function useUnreadBadge(): void {
  const unread = useUnreadCount();
  const last = useRef<number | null>(null);

  useEffect(() => {
    if (!isDesktop()) return;
    // The count recomputes on every listing; the badge only has to change when
    // the number does. Without this, marking one thread read redraws the dock
    // icon for every other thread in the list too.
    if (last.current === unread) return;
    last.current = unread;
    void invoke('set_unread_badge', { count: unread }).catch(() => {
      // A platform without a dock, or a window that has gone. There is nothing
      // to tell the user about a number that could not be drawn.
    });
  }, [unread]);
}
