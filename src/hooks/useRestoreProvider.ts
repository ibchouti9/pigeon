import { useRef } from 'react';
import { mailConnected } from '../data/imap/connect';
import { ImapMailProvider } from '../data/imap/imapProvider';
import { useMail } from '../store/mail';

/**
 * The store starts on `MockMailProvider`, which is right for the demo account
 * and for tests. A user whose app password is in the Keychain has real mail,
 * and without this every launch dropped them back onto the demo mailbox while
 * still showing them as onboarded — real mail visible before the restart,
 * someone else's afterwards.
 *
 * Runs during the first render rather than in an effect: an effect fires after
 * the shell has already started loading the inbox, and those requests would go
 * to the wrong provider. `mailConnected` is synchronous because `primeMail`
 * ran before the first render — see `main.tsx`.
 */
export function useRestoreProvider(): void {
  const done = useRef(false);
  if (done.current) return;
  done.current = true;

  if (!mailConnected()) return;
  if (useMail.getState().provider.kind === 'gmail') return;
  useMail.getState().setProvider(new ImapMailProvider());
}
