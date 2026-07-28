import { useEffect, useRef } from 'react';
import { useMail } from '../store/mail';
import { invoke, isDesktop } from '../lib/desktop';

/**
 * Mirrors "who may interrupt me" down to the engine.
 *
 * §2.3 is decided up here, against `localStorage` and a screening cutoff, and
 * Gmail knows nothing about it — the INBOX on the server holds everyone. That
 * is fine while Pigeon is open and useless the moment it is not: iOS wakes the
 * app into a fresh process with no webview to ask, and something still has to
 * decide whether the message that just arrived is worth a notification.
 *
 * What goes down is the union of the two ways a sender gets through: an
 * explicit approval, and being someone the user has written to. It is a
 * projection of the rule rather than the rule — the cutoff and each thread's
 * own start date stay up here — so the engine's copy is deliberately the
 * narrower one. An address missing from it costs a notification; the mail
 * still arrives, and still waits in the Screener where it was going anyway.
 */
export function useNotifyAllowlist(): void {
  const approved = useMail((s) => s.approved);
  const contacts = useMail((s) => s.contacts);
  const sent = useRef<string | null>(null);

  useEffect(() => {
    if (!isDesktop()) return;

    const emails = Array.from(
      new Set([
        ...approved.map((s) => s.email.toLowerCase()),
        ...contacts.map((c) => c.email.toLowerCase()),
      ]),
    ).sort();

    /*
     * Both lists are rebuilt on every load, so this runs on every refresh with
     * the same content. Comparing the serialised set means the file is only
     * rewritten when somebody is actually approved or written to.
     */
    const key = emails.join('\n');
    if (sent.current === key) return;
    sent.current = key;

    void invoke('mail_set_notify_allowlist', { emails }).catch(() => {
      // A build without the command, or a disk that refused. The consequence
      // is a quieter phone, not a broken one, and there is nothing the user
      // could do with the news.
    });
  }, [approved, contacts]);
}
