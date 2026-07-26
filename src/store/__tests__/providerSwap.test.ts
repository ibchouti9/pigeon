import { beforeEach, describe, expect, it } from 'vitest';
import { useMail } from '../mail';
import { MockMailProvider } from '../../data/mock/mockProvider';
import { providerForScenario } from '../../data/mock/scenarios';
import type { MailProvider } from '../../data/provider';
import type { Thread } from '../../types';

/**
 * A load started against one provider must not apply after another has been
 * installed. Without this, signing out of Gmail back to the demo account — or
 * switching scenarios in the dev harness — lets the previous account's mail
 * land in the new one's screens, seconds after the swap.
 */
function slowProvider(threads: Thread[], delayMs: number): MailProvider {
  const base = new MockMailProvider();
  return {
    ...base,
    kind: 'mock',
    getAccount: () => base.getAccount(),
    listThreads: () =>
      new Promise<Thread[]>((resolve) => setTimeout(() => resolve(threads), delayMs)),
  } as unknown as MailProvider;
}

describe('swapping the mail provider', () => {
  beforeEach(() => {
    localStorage.clear();
    MockMailProvider.reset();
  });

  it('discards a slow load from the previous provider', async () => {
    const stale = [{ id: 'stale', subject: 'From the old account' }] as unknown as Thread[];
    useMail.getState().setProvider(slowProvider(stale, 40));

    // Start the slow load, then swap before it resolves.
    const pending = useMail.getState().loadThreads('inbox');
    useMail.getState().setProvider(providerForScenario('empty'));
    await useMail.getState().loadThreads('inbox');
    await pending;

    // Give the stale promise time to land if it were going to.
    await new Promise((r) => setTimeout(r, 60));

    expect(useMail.getState().inbox).toEqual([]);
    expect(useMail.getState().inbox.some((t) => t.id === 'stale')).toBe(false);
  });

  it('discards a slow failure from the previous provider', async () => {
    useMail.getState().setProvider(providerForScenario('error'));
    const pending = useMail.getState().loadThreads('inbox');

    useMail.getState().setProvider(new MockMailProvider());
    await useMail.getState().loadThreads('inbox');
    await pending;
    await new Promise((r) => setTimeout(r, 20));

    expect(useMail.getState().status.inbox).toBe('ready');
    expect(useMail.getState().inbox.length).toBeGreaterThan(0);
  });

  it('bumps the epoch on every swap', () => {
    const before = useMail.getState().providerEpoch;
    useMail.getState().setProvider(new MockMailProvider());
    useMail.getState().setProvider(new MockMailProvider());
    expect(useMail.getState().providerEpoch).toBe(before + 2);
  });
});
