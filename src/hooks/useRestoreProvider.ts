import { useRef } from 'react';
import { isSignedIn } from '../data/gmail/auth';
import { GmailMailProvider } from '../data/gmail/gmailProvider';
import { useMail } from '../store/mail';

/**
 * The store starts on `MockMailProvider`, which is right for the demo account
 * and for tests. A user who has been through Google consent has a token in
 * `localStorage`, and without this every reload dropped them back onto the demo
 * mailbox while still showing them as onboarded — real mail visible before the
 * refresh, someone else's afterwards.
 *
 * Runs during the first render rather than in an effect: an effect fires after
 * the shell has already started loading the inbox, and those requests would go
 * to the wrong provider.
 */
export function useRestoreProvider(): void {
  const done = useRef(false);
  if (done.current) return;
  done.current = true;

  if (!isSignedIn()) return;
  if (useMail.getState().provider.kind === 'gmail') return;
  useMail.getState().setProvider(new GmailMailProvider());
}
