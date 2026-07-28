import { beforeEach, describe, expect, it } from 'vitest';
import { LOCAL_DRAFT_ID, useMail } from '../mail';
import { useCompose } from '../compose';
import { MockMailProvider } from '../../data/mock/mockProvider';

/**
 * `Place` was a two-value union, so a message you sent that nobody answered
 * was invisible in the whole product and Drafts did not exist at all.
 *
 * The distinction these pin: Sent and Drafts are *views*, not places. §2.1
 * puts a thread in exactly one place and every §2.3 rule is written against
 * that — a conversation you replied to is in your inbox and in your sent mail
 * at once, so widening `Place` would have made "exactly one" quietly false.
 */
describe('Sent', () => {
  beforeEach(() => {
    localStorage.clear();
    MockMailProvider.reset();
    useMail.getState().setProvider(new MockMailProvider());
    useCompose.getState().close();
  });

  it('lists conversations the user has written in', async () => {
    await useMail.getState().loadThreads('sent');
    const sent = useMail.getState().sent;

    expect(sent.length).toBeGreaterThan(0);
    for (const thread of sent) {
      expect(thread.messages.some((m) => m.isFromUser)).toBe(true);
    }
  });

  it('does not move a thread out of the place it lives in', async () => {
    await useMail.getState().loadThreads('inbox');
    await useMail.getState().loadThreads('sent');

    const inboxIds = new Set(useMail.getState().inbox.map((t) => t.id));
    const alsoSent = useMail.getState().sent.filter((t) => inboxIds.has(t.id));
    // A reply you sent is in both lists at once. That is the whole reason
    // these are views rather than a widened Place.
    expect(alsoSent.length).toBeGreaterThan(0);
  });
});

describe('Drafts', () => {
  beforeEach(() => {
    localStorage.clear();
    MockMailProvider.reset();
    useMail.getState().setProvider(new MockMailProvider());
    useCompose.getState().close();
  });

  it('is empty when nothing has been written', async () => {
    await useMail.getState().loadThreads('drafts');
    expect(useMail.getState().drafts).toEqual([]);
  });

  it('lists the open draft, so the folder is not always empty', async () => {
    useCompose.getState().open();
    useCompose.getState().update({ subject: 'Half-written', body: 'Finish later.' });

    await useMail.getState().loadThreads('drafts');
    const rows = useMail.getState().drafts;

    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(LOCAL_DRAFT_ID);
    expect(rows[0].subject).toBe('Half-written');
  });

  it('ignores a composer that was opened and never typed into', async () => {
    useCompose.getState().open();

    await useMail.getState().loadThreads('drafts');

    expect(useMail.getState().drafts).toEqual([]);
  });

  it('titles an untitled draft rather than listing a blank row', async () => {
    useCompose.getState().open();
    useCompose.getState().update({ body: 'No subject on this one.' });

    await useMail.getState().loadThreads('drafts');

    expect(useMail.getState().drafts[0].subject).toBe('(no subject)');
  });
});
