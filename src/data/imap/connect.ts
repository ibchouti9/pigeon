import { invoke, isDesktop } from '../../lib/desktop';
import type { BridgeMailStatus } from './bridge';

/**
 * Connecting Gmail: an email address and an app password, verified end to end
 * by one IMAP LOGIN before anything is stored. This module is the entire auth
 * surface — it replaced an OAuth client, a consent screen, a loopback
 * listener and a five-step console walkthrough.
 *
 * The connection state is cached synchronously on purpose: the provider is
 * chosen *during* the first render (`useRestoreProvider`), before any effect
 * could resolve a promise, and getting that wrong shows a signed-in user the
 * demo mailbox. `primeMail` fills the cache before the first render;
 * `main.tsx` awaits it.
 */

let status: BridgeMailStatus = { connected: false, email: null };

/** One Keychain read, before anything renders. A no-op on the web. */
export async function primeMail(): Promise<void> {
  if (!isDesktop()) return;
  try {
    status = await invoke<BridgeMailStatus>('mail_status');
  } catch {
    // A bridge that will not answer reads as not connected, and the Welcome
    // screen offers to connect — the safe direction to be wrong in.
  }
}

/** Whether this build can reach real mail at all. Only the app can. */
export function canConnectMail(): boolean {
  return isDesktop();
}

export function mailConnected(): boolean {
  return status.connected;
}

/**
 * Verifies and stores the sign-in. Rust's failure strings are already copy —
 * an ordinary Google password gets different advice than a mistyped app
 * password, because Gmail distinguishes them and users cannot.
 */
export async function connectGmail(email: string, password: string): Promise<void> {
  try {
    await invoke('mail_connect', { email, password });
  } catch (error) {
    throw new Error(typeof error === 'string' ? error : 'Pigeon couldn\'t reach Gmail. Check your connection and try again.');
  }
  status = { connected: true, email };
}

/** Forgets the app password and drops the connection. */
export async function disconnectGmail(): Promise<void> {
  status = { connected: false, email: null };
  await invoke('mail_disconnect').catch(() => undefined);
}

/** Where an app password comes from. Opened in the user's real browser. */
export const APP_PASSWORD_URL = 'https://myaccount.google.com/apppasswords';
