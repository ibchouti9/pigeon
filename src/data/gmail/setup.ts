import { invoke } from '../../lib/desktop';
import { noteClientChanged } from './auth';

/**
 * The one-time Google client setup, desktop only.
 *
 * Pigeon asks Google for `gmail.modify`, which Google classes as a *restricted*
 * scope: an app that ships its own client and wants strangers to use it has to
 * pass a paid security assessment first. Pigeon doesn't, so each person
 * registers their own client — about five minutes in the Google console, once
 * per machine. `SETUP_STEPS` is that walk, and everything else here is about
 * getting the resulting file into the Keychain with as few chances to go wrong
 * as possible.
 *
 * Nothing in this file reads or returns the credentials. The JSON goes from the
 * file straight into Rust; the webview only ever learns whether it was accepted.
 */

export interface SetupStep {
  /** Shown as the step's heading. */
  title: string;
  /** One line of what to do, in the console's own words where possible. */
  detail: string;
  /** Deep link, opened in the user's real browser. */
  url: string;
  /** True when skipping it costs a feature rather than breaking setup. */
  optional?: boolean;
}

/**
 * Deep links, not instructions to go hunting. Each lands on the exact page —
 * the console's navigation is four levels deep and renamed roughly annually,
 * so "go to APIs & Services → Credentials" ages badly in a way a URL does not.
 */
export const SETUP_STEPS: SetupStep[] = [
  {
    title: 'Make a Google project',
    detail: 'Any name. It exists so Google has something to hang the permission on.',
    url: 'https://console.cloud.google.com/projectcreate',
  },
  {
    title: 'Turn on the Gmail API',
    detail: 'One button, on the page this opens.',
    url: 'https://console.cloud.google.com/apis/library/gmail.googleapis.com',
  },
  {
    title: 'Turn on the People API',
    detail:
      'Also one button. This is how Pigeon knows who is already in your contacts — skip it and Pigeon works out who you know from mail you have sent instead.',
    url: 'https://console.cloud.google.com/apis/library/people.googleapis.com',
    optional: true,
  },
  {
    title: 'Fill in the consent screen, and add yourself as a test user',
    detail:
      'Pick External, give it any app name and your own email. Then, under Audience, add your own Google address as a test user — without that, Google refuses at the last step.',
    url: 'https://console.cloud.google.com/auth/overview',
  },
  {
    title: 'Create the client, and download its JSON',
    detail:
      'Create client → application type Desktop app → Create. Then use the download button on the row it makes.',
    url: 'https://console.cloud.google.com/auth/clients',
  },
];

/** Opens the native file picker. `false` means the user cancelled. */
export async function pickCredentials(): Promise<boolean> {
  const chosen = await invoke<boolean>('google_pick_credentials');
  if (chosen) noteClientChanged(true);
  return chosen;
}

/** Takes a path from a file dropped on the window. */
export async function setCredentialsFromPath(path: string): Promise<void> {
  await invoke('google_set_credentials_from_path', { path });
  noteClientChanged(true);
}

/** Takes the JSON pasted as text, for anyone who would rather not use a file. */
export async function setCredentialsFromText(raw: string): Promise<void> {
  await invoke('google_set_credentials', { raw });
  noteClientChanged(true);
}

/**
 * Forgets the client and any grant behind it.
 *
 * Worth having as its own action: a client that is valid JSON but wrong — the
 * project without the Gmail API switched on, say — otherwise leaves the user
 * stuck, because every screen now believes setup is done and stops offering it.
 */
export async function forgetCredentials(): Promise<void> {
  await invoke('google_forget_credentials');
  noteClientChanged(false);
}

/** Whether a dropped file is worth sending to Rust at all. */
export function looksLikeCredentials(path: string): boolean {
  return path.toLowerCase().endsWith('.json');
}
