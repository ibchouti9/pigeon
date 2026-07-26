import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Every Gmail request asks for a token, and the thread walk issues ten at a
 * time. When the hour-long token lapsed mid-walk, all ten found none and each
 * opened its own Google window — the browser blocks nine, and a blocked window
 * was reported as the user refusing consent.
 *
 * These drive the GIS global directly, since the flow is otherwise only
 * reachable from a real Google popup.
 */
describe('token renewal', () => {
  let opened: number;
  let callbacks: ((response: unknown) => void)[];

  beforeEach(() => {
    vi.resetModules();
    sessionStorage.clear();
    opened = 0;
    callbacks = [];

    vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'client-123.apps.googleusercontent.com');
    vi.stubGlobal('google', {
      accounts: {
        oauth2: {
          initTokenClient: (config: { callback: (r: unknown) => void }) => ({
            requestAccessToken: () => {
              opened += 1;
              callbacks.push(config.callback);
            },
          }),
          revoke: (_t: string, done: () => void) => done(),
          hasGrantedAllScopes: () => true,
        },
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('opens one Google window for ten concurrent requests', async () => {
    const { accessToken } = await import('../auth');

    const pending = Promise.all(Array.from({ length: 10 }, () => accessToken()));
    // Let the GIS script "load" and the client be constructed.
    await vi.waitFor(() => expect(opened).toBeGreaterThan(0));

    callbacks[0]({ access_token: 'tok', expires_in: 3600, scope: '' });
    const tokens = await pending;

    expect(opened).toBe(1);
    expect(tokens.every((t) => t === 'tok')).toBe(true);
  });

  it('renews again after the shared attempt has settled', async () => {
    const { accessToken, clearToken } = await import('../auth');

    const first = accessToken();
    await vi.waitFor(() => expect(callbacks).toHaveLength(1));
    callbacks[0]({ access_token: 'tok1', expires_in: 3600, scope: '' });
    await first;

    clearToken();

    const second = accessToken();
    await vi.waitFor(() => expect(callbacks).toHaveLength(2));
    callbacks[1]({ access_token: 'tok2', expires_in: 3600, scope: '' });

    expect(await second).toBe('tok2');
    expect(opened).toBe(2);
  });

  it('lets every waiter see the failure, and does not wedge', async () => {
    const { accessToken } = await import('../auth');

    const pending = Promise.allSettled([accessToken(), accessToken()]);
    await vi.waitFor(() => expect(callbacks).toHaveLength(1));
    callbacks[0]({ error: 'access_denied' });

    const results = await pending;
    expect(results.every((r) => r.status === 'rejected')).toBe(true);

    // The next attempt gets a fresh window rather than the failed promise.
    const retry = accessToken();
    await vi.waitFor(() => expect(callbacks).toHaveLength(2));
    callbacks[1]({ access_token: 'tok', expires_in: 3600, scope: '' });
    expect(await retry).toBe('tok');
  });
});
