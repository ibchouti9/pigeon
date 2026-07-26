/**
 * Google sign-in, in two flavours.
 *
 * Pigeon has no backend (D41), and how it reaches Google depends on where it is
 * running:
 *
 *  - **The macOS app** uses Google's installed-app flow, implemented in Rust
 *    (`src-tauri/src/google.rs`): PKCE, the system browser, a loopback
 *    redirect, and a refresh token kept in the Keychain. Consent survives a
 *    restart, and there is no redirect URI to register or mistype.
 *  - **The web build** uses Google Identity Services, which hands the page a
 *    one-hour access token and no refresh token. When it lapses Pigeon asks for
 *    another, and Google's guidance is that the ask needs a user gesture behind
 *    it — so a lapse mid-session can surface as a blocked pop-up.
 *
 * Everything below the dispatchers at the end of this file belongs to one
 * flavour or the other. Callers see one surface and should not care.
 */

import { invoke, isDesktop } from '../../lib/desktop';

const GIS_SRC = 'https://accounts.google.com/gsi/client';

/**
 * The four permissions §3.1 branch 2b refers to. Consent shows one checkbox per
 * scope; Pigeon needs all four, and says so when a user unticks one.
 *
 * The desktop flow asks for the same four, from `SCOPES` in
 * `src-tauri/src/google.rs`. The list is stated twice because it is needed on
 * both sides of a language boundary; if one changes, change the other.
 */
const SCOPES = [
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/contacts.readonly',
  'https://www.googleapis.com/auth/userinfo.email',
] as const;

export class AuthError extends Error {
  readonly kind: 'denied' | 'partial-scopes' | 'no-client-id' | 'unavailable';

  constructor(message: string, kind: AuthError['kind']) {
    super(message);
    this.name = 'AuthError';
    this.kind = kind;
  }
}

interface TokenResponse {
  access_token?: string;
  expires_in?: number;
  scope?: string;
  error?: string;
}

interface TokenClient {
  requestAccessToken: (overrides?: { prompt?: string }) => void;
}

interface GoogleGlobal {
  accounts: {
    oauth2: {
      initTokenClient: (config: {
        client_id: string;
        scope: string;
        prompt?: string;
        callback: (response: TokenResponse) => void;
        error_callback?: (error: { type?: string }) => void;
      }) => TokenClient;
      revoke: (token: string, done: () => void) => void;
      /** GIS's own scope check; see the note where it is used. */
      hasGrantedAllScopes?: (response: TokenResponse, ...scopes: string[]) => boolean;
    };
  };
}

declare global {
  interface Window {
    google?: GoogleGlobal;
  }
}

let scriptPromise: Promise<void> | null = null;

function loadGis(): Promise<void> {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  if (scriptPromise) return scriptPromise;

  scriptPromise = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = GIS_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () =>
      reject(
        new AuthError(
          'Pigeon couldn\'t load Google sign-in. Check your connection and try again.',
          'unavailable',
        ),
      );
    document.head.appendChild(script);
  });

  return scriptPromise;
}

/**
 * The web build's client, baked in at build time.
 *
 * The desktop build has no equivalent: its credentials live in the Keychain and
 * are set from inside the app, so nothing here is consulted there.
 */
function webClientId(): string | null {
  const id = import.meta.env.VITE_GOOGLE_CLIENT_ID;
  return typeof id === 'string' && id.length > 0 ? id : null;
}

interface StoredToken {
  accessToken: string;
  /** Epoch ms. */
  expiresAt: number;
  scopes: string[];
}

const TOKEN_KEY = 'pigeon.google';

function readToken(): StoredToken | null {
  try {
    const raw = sessionStorage.getItem(TOKEN_KEY);
    if (!raw) return null;
    const token = JSON.parse(raw) as StoredToken;
    // Treat anything inside a minute of expiry as already gone.
    return token.expiresAt - 60_000 > Date.now() ? token : null;
  } catch {
    return null;
  }
}

function writeToken(token: StoredToken): void {
  try {
    sessionStorage.setItem(TOKEN_KEY, JSON.stringify(token));
  } catch {
    // Sign-in still works for this page load without persistence.
  }
}

export function clearToken(): void {
  try {
    sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    // Nothing to clear.
  }
}

function request(clientId: string, prompt: string): Promise<StoredToken> {
  return new Promise((resolve, reject) => {
    const client = window.google!.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: SCOPES.join(' '),
      prompt,
      callback: (response) => {
        if (response.error || !response.access_token) {
          reject(
            new AuthError(
              "Pigeon didn't get access to your mail. Google needs permission to read and send on your behalf for Pigeon to work. Try connecting again.",
              'denied',
            ),
          );
          return;
        }

        const granted = (response.scope ?? '').split(' ').filter(Boolean);
        /*
         * Google's own check, not a string comparison of our own. It normalises
         * some scopes in the response — `.../auth/userinfo.email` comes back as
         * the alias `email` — so comparing the returned strings to the ones we
         * asked for can reject a grant that fully succeeded, and there is no way
         * past that screen once it does.
         */
        const hasAll = window.google?.accounts.oauth2.hasGrantedAllScopes;
        const missing = hasAll
          ? hasAll(response, ...SCOPES)
            ? []
            : ['some']
          : SCOPES.filter((s) => !granted.includes(s));
        if (missing.length > 0) {
          reject(
            new AuthError(
              'Pigeon needs all four permissions to sort your mail. Connect again and leave the checkboxes ticked.',
              'partial-scopes',
            ),
          );
          return;
        }

        const token: StoredToken = {
          accessToken: response.access_token,
          expiresAt: Date.now() + (response.expires_in ?? 3600) * 1000,
          scopes: granted,
        };
        writeToken(token);
        resolve(token);
      },
      error_callback: (error?: { type?: string }) =>
        reject(
          // A blocked popup is not a refusal, and telling the user to "try
          // connecting again" sends them round the same loop. This one happens
          // when the token lapses mid-session and the renewal has no user
          // gesture behind it.
          error?.type === 'popup_failed_to_open'
            ? new AuthError(
                'Your browser blocked the Google window. Allow pop-ups for this site, then connect again.',
                'unavailable',
              )
            : new AuthError(
                "Pigeon didn't get access to your mail. Google needs permission to read and send on your behalf for Pigeon to work. Try connecting again.",
                'denied',
              ),
        ),
    });

    client.requestAccessToken({ prompt });
  });
}

async function webSignIn(): Promise<void> {
  const clientId = webClientId();
  if (!clientId) {
    throw new AuthError(
      'This copy of Pigeon has no Google client configured, so it can only show the demo account. The macOS app can connect real mail.',
      'no-client-id',
    );
  }
  await loadGis();
  await request(clientId, 'consent');
}

/** One renewal at a time, however many callers arrive at once. */
let renewal: Promise<StoredToken> | null = null;

/**
 * The renewal is shared. Every Gmail request calls this, and the walk issues
 * ten at a time — so when the hour-long token lapsed mid-walk, all ten found no
 * token and each opened its own Google window. The browser blocks nine of them,
 * and a blocked window used to be reported as the user refusing consent.
 *
 * Note that the token flow has no truly silent renewal: Google's guidance is to
 * obtain a token from a user gesture, and a renewal triggered by a background
 * fetch may be blocked whatever we do. Sharing it at least means one prompt
 * rather than ten, and an honest message when it is blocked.
 */
async function webAccessToken(): Promise<string> {
  const existing = readToken();
  if (existing) return existing.accessToken;

  const clientId = webClientId();
  if (!clientId) {
    throw new AuthError(
      'This copy of Pigeon has no Google client configured.',
      'no-client-id',
    );
  }

  if (!renewal) {
    renewal = loadGis()
      .then(() => request(clientId, ''))
      .finally(() => {
        renewal = null;
      });
  }
  const token = await renewal;
  return token.accessToken;
}

async function webSignOut(): Promise<void> {
  const token = readToken();
  clearToken();
  if (!token) return;
  await loadGis().catch(() => undefined);
  await new Promise<void>((resolve) => {
    if (!window.google?.accounts?.oauth2) {
      resolve();
      return;
    }
    window.google.accounts.oauth2.revoke(token.accessToken, resolve);
  });
}

/* -------------------------------------------------------------------------- */
/* Desktop — the installed-app flow, over the Tauri bridge                      */
/* -------------------------------------------------------------------------- */

interface Session {
  accessToken: string;
  /** Epoch ms, so it compares against `Date.now()` directly. */
  expiresAt: number;
}

/**
 * Answered once at startup by `primeAuth`, then kept current by the setup
 * calls below.
 *
 * It is a cache rather than a lookup because the screens that need it need it
 * *synchronously*: `useRestoreProvider` picks the mail provider during the
 * first render, before an effect could have resolved a promise, and getting
 * that wrong shows a signed-in user the demo mailbox.
 */
let desktopSetup = { hasClient: false, hasSession: false };

/** The live access token, or null when there isn't one yet. */
let desktopSession: Session | null = null;

/** Shared, for the same reason the web renewal is: a walk asks ten at a time. */
let desktopRenewal: Promise<Session> | null = null;

/** Rust returns `Err(String)`; every one of them is already user-facing copy. */
function asAuthError(error: unknown): AuthError {
  if (error instanceof AuthError) return error;
  const message =
    typeof error === 'string'
      ? error
      : error instanceof Error
        ? error.message
        : "Pigeon couldn't reach Google. Try connecting again.";
  return new AuthError(message, 'denied');
}

/**
 * Rust's signal for "the user gave up", which must not read as a failure.
 * Matches `CANCELLED` in `src-tauri/src/google.rs`.
 */
const CANCELLED = 'pigeon:cancelled';

/** Thrown by `signIn` when the user pressed Cancel. Carries no copy. */
export class SignInCancelled extends Error {
  constructor() {
    super(CANCELLED);
    this.name = 'SignInCancelled';
  }
}

async function desktopSignIn(): Promise<void> {
  try {
    desktopSession = await invoke<Session>('google_sign_in');
    desktopSetup = { ...desktopSetup, hasSession: true };
  } catch (error) {
    if (typeof error === 'string' && error === CANCELLED) throw new SignInCancelled();
    throw asAuthError(error);
  }
}

/**
 * Abandons a sign-in that is going nowhere.
 *
 * Needed because Google does not always come back. When it rejects the request
 * outright — a client ID that doesn't exist, a project with no consent screen —
 * it renders its own error page in the browser and never redirects, so the
 * loopback listener waits out its full five minutes. The user, meanwhile, is
 * looking at a spinner and an error page that Pigeon cannot see.
 */
export async function cancelSignIn(): Promise<void> {
  if (!isDesktop()) return;
  await invoke('google_cancel_sign_in').catch(() => undefined);
}

async function desktopAccessToken(): Promise<string> {
  // A minute of headroom, matching the web path: a token about to lapse is
  // treated as already gone rather than raced against.
  if (desktopSession && desktopSession.expiresAt - 60_000 > Date.now()) {
    return desktopSession.accessToken;
  }

  if (!desktopRenewal) {
    desktopRenewal = invoke<Session>('google_refresh').finally(() => {
      desktopRenewal = null;
    });
  }

  try {
    desktopSession = await desktopRenewal;
    return desktopSession.accessToken;
  } catch (error) {
    // Rust has already dropped a refresh token Google retired, so the shell
    // must stop believing there is a session behind it.
    desktopSession = null;
    desktopSetup = { ...desktopSetup, hasSession: false };
    throw asAuthError(error);
  }
}

async function desktopSignOut(): Promise<void> {
  desktopSession = null;
  desktopSetup = { ...desktopSetup, hasSession: false };
  await invoke('google_sign_out').catch(() => undefined);
}

/* -------------------------------------------------------------------------- */
/* What the screens see                                                        */
/* -------------------------------------------------------------------------- */

export interface GmailStatus {
  /** "Connect Gmail" will reach Google rather than the demo account. */
  canConnect: boolean;
  /** This build can set up a Google client from inside the app. */
  canSetUp: boolean;
  /** A stored grant survives, so connecting needs no consent screen. */
  hasSession: boolean;
}

/**
 * Synchronous on purpose — see `desktopSetup`. Accurate from the moment
 * `primeAuth` has resolved, which `main.tsx` awaits before the first render.
 */
export function gmailStatus(): GmailStatus {
  if (!isDesktop()) {
    return { canConnect: webClientId() !== null, canSetUp: false, hasSession: false };
  }
  return {
    canConnect: desktopSetup.hasClient,
    canSetUp: true,
    hasSession: desktopSetup.hasSession,
  };
}

/** Called by the setup panel once it has stored, or dropped, a client. */
export function noteClientChanged(hasClient: boolean): void {
  desktopSetup = { hasClient, hasSession: hasClient && desktopSetup.hasSession };
  if (!hasClient) desktopSession = null;
}

/**
 * Reads the Keychain once, before anything renders. A no-op on the web, where
 * the answer is a build-time constant.
 */
export async function primeAuth(): Promise<void> {
  if (!isDesktop()) return;
  try {
    desktopSetup = await invoke<{ hasClient: boolean; hasSession: boolean }>(
      'google_setup_state',
    );
  } catch {
    // A Keychain that will not answer is indistinguishable from an empty one,
    // and both mean the same thing to the user: set the client up again.
  }
}

/** Opens Google's consent screen. Called only from O1. */
export async function signIn(): Promise<void> {
  return isDesktop() ? desktopSignIn() : webSignIn();
}

/**
 * Returns a live access token, renewing it when the last one lapsed. Throws
 * when Google has revoked Pigeon's permission, which the shell renders as the
 * token-revoked state in §5.5.
 */
export async function accessToken(): Promise<string> {
  return isDesktop() ? desktopAccessToken() : webAccessToken();
}

export function isSignedIn(): boolean {
  return isDesktop() ? desktopSetup.hasSession : readToken() !== null;
}

export async function signOut(): Promise<void> {
  return isDesktop() ? desktopSignOut() : webSignOut();
}
