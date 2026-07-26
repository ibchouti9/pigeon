import { beforeEach, describe, expect, it } from 'vitest';
import { useMail } from '../mail';
import { MockMailProvider } from '../../data/mock/mockProvider';
import { providerForScenario } from '../../data/mock/scenarios';

/**
 * §5.5 — a revoked token is its own state, not a connection error. It locks the
 * shell and offers "Connect Gmail", because "Try again" cannot possibly work.
 * The distinction lives in `MailError.code`, and a catch block that swallows
 * the error loses it silently: the user sees "Pigeon can't reach Gmail" and
 * retries forever.
 */
describe('a revoked token', () => {
  beforeEach(() => {
    localStorage.clear();
    MockMailProvider.reset();
    useMail.getState().setProvider(new MockMailProvider());
  });

  it('is not set for an ordinary connection failure', async () => {
    useMail.getState().setProvider(providerForScenario('error'));
    await useMail.getState().loadThreads('inbox');

    expect(useMail.getState().status.inbox).toBe('error');
    expect(useMail.getState().revoked).toBe(false);
  });

  it('is set when Google withdraws permission', async () => {
    useMail.getState().setProvider(providerForScenario('revoked'));
    await useMail.getState().loadThreads('inbox');

    expect(useMail.getState().status.inbox).toBe('error');
    expect(useMail.getState().revoked).toBe(true);
  });

  it('is recognised from any load, not just the inbox', async () => {
    useMail.getState().setProvider(providerForScenario('revoked'));
    await useMail.getState().loadHeld();
    expect(useMail.getState().revoked).toBe(true);
  });

  it('clears when a new provider is connected', async () => {
    useMail.getState().setProvider(providerForScenario('revoked'));
    await useMail.getState().loadThreads('inbox');
    expect(useMail.getState().revoked).toBe(true);

    useMail.getState().setProvider(new MockMailProvider());
    expect(useMail.getState().revoked).toBe(false);
  });
});
