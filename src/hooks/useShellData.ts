import { useEffect, useRef } from 'react';
import { useMail } from '../store/mail';
import { useOnline } from './useOnline';
import { useMailRefresh } from './useMailRefresh';
import { useNewMailNotice } from './useNewMailNotice';
import { useUnreadBadge } from './useUnreadBadge';
import { toast } from '../store/toast';

/**
 * Everything the shell does that is not layout: load the account and the five
 * lists every screen reads, keep them fresh, badge the icon, notify when mail
 * arrives from someone you chose, and say so when the network comes back.
 *
 * Lifted out of `AppShell` when the phone got a shell of its own. Two shells
 * that each remember to load the held senders is one shell away from a phone
 * that shows an empty Screener because someone added a sixth list to the other
 * file — and the same again for every hook added here since.
 */
export function useShellData(): void {
  const online = useOnline();
  const wasOffline = useRef(false);

  const loadAccount = useMail((s) => s.loadAccount);
  const loadThreads = useMail((s) => s.loadThreads);
  const loadHeld = useMail((s) => s.loadHeld);
  const loadSenders = useMail((s) => s.loadSenders);
  const loadContacts = useMail((s) => s.loadContacts);

  useMailRefresh();
  useNewMailNotice();
  useUnreadBadge();

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
}
