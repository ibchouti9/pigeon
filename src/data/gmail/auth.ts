/**
 * Google sign-in for a client with no server.
 *
 * Pigeon has no backend (D41), so it uses the Google Identity Services token
 * flow: the browser gets a short-lived access token directly and there is no
 * refresh token to store anywhere. When the token expires, Pigeon asks for
 * another one silently.
 */

const GIS_SRC = 'https://accounts.google.com/gsi/client';

/**
 * The four permissions §3.1 branch 2b refers to. Consent shows one checkbox per
 * scope; Pigeon needs all four, and says so when a user unticks one.
 */
export const SCOPES = [
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

export function googleClientId(): string | null {
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

/** Opens Google's consent screen. Called only from O1. */
export async function signIn(): Promise<void> {
  const clientId = googleClientId();
  if (!clientId) {
    throw new AuthError(
      'Pigeon needs a Google client ID. Add VITE_GOOGLE_CLIENT_ID to .env.local — the README explains how.',
      'no-client-id',
    );
  }
  await loadGis();
  await request(clientId, 'consent');
}

/** One renewal at a time, however many callers arrive at once. */
let renewal: Promise<StoredToken> | null = null;

/**
 * Returns a live access token, renewing it when the last one lapsed. Throws
 * when Google has revoked Pigeon's permission, which the shell renders as the
 * token-revoked state in §5.5.
 *
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
export async function accessToken(): Promise<string> {
  const existing = readToken();
  if (existing) return existing.accessToken;

  const clientId = googleClientId();
  if (!clientId) {
    throw new AuthError(
      'Pigeon needs a Google client ID. Add VITE_GOOGLE_CLIENT_ID to .env.local — the README explains how.',
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

export function isSignedIn(): boolean {
  return readToken() !== null;
}

export async function signOut(): Promise<void> {
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
