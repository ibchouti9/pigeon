import { beforeEach, describe, expect, it } from 'vitest';
import { useMail } from '../mail';
import { MockMailProvider } from '../../data/mock/mockProvider';
import type { MailProvider } from '../../data/provider';

/**
 * THROWAWAY test to verify whether decide()/setPlace()/reverse() apply a
 * providerEpoch guard the way loadThreads/loadHeld/etc do. Not part of the
 * permanent suite.
 */

function providerWithControlledDecide(base: MailProvider, controller: { reject?: () => void }) {
  let rejectFn: (e: unknown) => void;
  const pending = new Promise<void>((_, reject) => {
    rejectFn = reject;
  });
  controller.reject = () => rejectFn(new Error('write failed'));
  return {
    ...base,
    decideSender: () => pending,
  } as unknown as MailProvider;
}

describe('SCRATCH: providerEpoch guard on mutation paths', () => {
  beforeEach(() => {
    localStorage.clear();
    MockMailProvider.reset();
  });

  it('decide() catch handler restores stale held list after a provider swap', async () => {
    const base = new MockMailProvider();
    const controller: { reject?: () => void } = {};
    useMail.getState().setProvider(providerWithControlledDecide(base, controller));
    await useMail.getState().loadHeld();

    const staleHeld = useMail.getState().held;
    expect(staleHeld.length).toBeGreaterThan(0);
    const target = staleHeld[0];

    // Start a decide() against the OLD provider; it will hang until we reject it.
    const pending = useMail.getState().decide(target.sender.id, 'declined');
    expect(useMail.getState().held).toHaveLength(staleHeld.length - 1); // optimistic removal

    // Now swap providers — e.g. dev harness scenario switch, or sign-out — while
    // the decide() from the old provider is still in flight.
    useMail.getState().setProvider(new MockMailProvider());
    await useMail.getState().loadHeld();
    const freshHeld = useMail.getState().held;

    // Now let the original (stale) decide() fail.
    controller.reject!();
    await pending;

    // BUG: decide()'s catch block does `set({ held })` unconditionally, with no
    // providerEpoch check, so it clobbers the *new* provider's held list with
    // the old provider's pre-decide snapshot.
    const finalHeld = useMail.getState().held;
    console.log('fresh held ids', freshHeld.map((h) => h.sender.id));
    console.log('final held ids', finalHeld.map((h) => h.sender.id));
    console.log('stale held ids', staleHeld.map((h) => h.sender.id));

    expect(finalHeld).toEqual(freshHeld);
  });
});
