import { beforeEach, describe, expect, it } from 'vitest';
import type { Message, Thread } from '../../types';
import { SenderDecisions } from '../decisions';

/**
 * §2.3's decision rules against the intervals model, transition by transition.
 *
 * The flags model this replaced was revised six times, and four of those
 * revisions introduced a defect the previous one didn't have — every one an
 * interaction between `keptExisting`, `reversedDecline` and the third decision
 * in a row. These cases are that history, written down: each `it` below is
 * either a §2.3 sentence or a defect one of the six revisions actually shipped.
 */

const SENDER = 'casey@newsletter.example';

/** A thread whose first message is `started`. Only the dates matter here. */
function thread(id: string, started: string, last = started): Thread {
  const message = (date: string): Message => ({
    id: `${id}-${date}`,
    threadId: id,
    subject: 'A thread',
    from: { name: 'Casey', email: SENDER },
    to: [],
    cc: [],
    date,
    body: 'hello',
    attachments: [],
    isFromUser: false,
  });
  return {
    id,
    subject: 'A thread',
    place: 'inbox',
    unread: false,
    lastMessageAt: last,
    messages: [message(started), ...(last !== started ? [message(last)] : [])],
  };
}

/** Deterministic clock: each decision lands at a chosen instant. */
function at(iso: string, run: () => void) {
  const real = Date.now;
  Date.now = () => new Date(iso).getTime();
  // toISOString comes from the Date instance, so pin the constructor's "now".
  const RealDate = Date;
  // eslint-disable-next-line no-global-assign
  globalThis.Date = class extends RealDate {
    constructor(...args: unknown[]) {
      if (args.length === 0) super(iso);
      else super(...(args as [string]));
    }
  } as DateConstructor;
  try {
    run();
  } finally {
    // eslint-disable-next-line no-global-assign
    globalThis.Date = RealDate;
    Date.now = real;
  }
}

const OLD = thread('old', '2024-01-10T00:00:00.000Z');
const DURING_DECLINE = thread('mid', '2024-03-10T00:00:00.000Z');
const DURING_APPROVAL = thread('kept', '2024-05-10T00:00:00.000Z');
const NEW = thread('new', '2024-07-10T00:00:00.000Z');

const T_DECLINE = '2024-02-01T00:00:00.000Z';
const T_APPROVE = '2024-04-01T00:00:00.000Z';
const T_DECLINE_2 = '2024-06-01T00:00:00.000Z';

/**
 * A listing row: one synthetic message dated to the newest, with the
 * conversation's real span carried alongside it. This is what the real provider
 * lists — bodies are fetched when a conversation is opened, not to draw a list.
 */
function previewRow(id: string, started: string, last: string): Thread {
  const row = thread(id, started, last);
  return {
    ...row,
    preview: true,
    firstMessageAt: started,
    messageCount: 2,
    messages: [{ ...row.messages[row.messages.length - 1], body: 'a preview line' }],
  };
}

describe('when a conversation started', () => {
  /**
   * Every §2.3 rule is about the conversation, so a decline reaches a thread by
   * its *start*. A listing row holds one message dated to the newest, and
   * reducing those would date a conversation from before the decline to after
   * it — which un-hides mail the user has already declined.
   */
  it('reads a listing row by its span, not by its one message', () => {
    const decisions = SenderDecisions.load('marc@ferrum.dev');
    at(T_DECLINE, () => decisions.decide(SENDER, 'declined'));
    at(T_APPROVE, () => decisions.decide(SENDER, 'approved'));

    // Started while the sender stood declined; last reply after the approval.
    const row = previewRow('mid', '2024-03-10T00:00:00.000Z', '2024-05-10T00:00:00.000Z');
    expect(decisions.hidden(row, SENDER)).toBe(true);

    // The same conversation, fully fetched, has to agree.
    expect(decisions.hidden(thread('mid', '2024-03-10T00:00:00.000Z', '2024-05-10T00:00:00.000Z'), SENDER)).toBe(true);
  });
});

describe('the screening cutoff', () => {
  it('screens what starts after setup and leaves the rest alone', () => {
    const decisions = SenderDecisions.load('marc@ferrum.dev');
    decisions.beginScreening('2024-04-01T00:00:00.000Z');

    expect(decisions.screens(thread('before', '2024-01-10T00:00:00.000Z'))).toBe(false);
    expect(decisions.screens(thread('after', '2024-07-10T00:00:00.000Z'))).toBe(true);
    // An old conversation with a new reply is still an old conversation.
    expect(
      decisions.screens(thread('long', '2024-01-10T00:00:00.000Z', '2024-07-10T00:00:00.000Z')),
    ).toBe(false);
  });

  /**
   * The line is a fact about when the user set Pigeon up. A line that moved
   * would take senders out of the Screener without anyone deciding anything.
   */
  it('never moves once it is set', () => {
    const decisions = SenderDecisions.load('marc@ferrum.dev');
    decisions.beginScreening('2024-04-01T00:00:00.000Z');
    decisions.beginScreening('2024-09-01T00:00:00.000Z');
    expect(decisions.screenFrom()).toBe('2024-04-01T00:00:00.000Z');
  });

  /** With no line recorded, everything is screened — how it behaved before. */
  it('screens everything until a line is recorded', () => {
    const decisions = SenderDecisions.load('nobody@ferrum.dev');
    expect(decisions.screenFrom()).toBeNull();
    expect(decisions.screens(thread('old', '2001-01-01T00:00:00.000Z'))).toBe(true);
  });
});

describe('§2.3 sender decisions', () => {
  let decisions: SenderDecisions;

  beforeEach(() => {
    localStorage.clear();
    decisions = SenderDecisions.load('me@example.com');
  });

  it('hides nothing for a sender nobody has ruled on', () => {
    expect(decisions.hidden(OLD, SENDER)).toBe(false);
    expect(decisions.has(SENDER)).toBe(false);
    expect(decisions.status(SENDER)).toBeUndefined();
  });

  it('a Screener decline hides everything — history included (D7)', () => {
    at(T_DECLINE, () => decisions.decide(SENDER, 'declined'));

    expect(decisions.hidden(OLD, SENDER)).toBe(true);
    expect(decisions.hidden(NEW, SENDER)).toBe(true);
    expect(decisions.status(SENDER)).toBe('declined');
  });

  it('reports a Screener decline as the kind whose held mail gets archived', () => {
    let verdict = { screenerDecline: false };
    at(T_DECLINE, () => {
      verdict = decisions.decide(SENDER, 'declined');
    });
    expect(verdict.screenerDecline).toBe(true);
  });

  it('declining an approved sender keeps their existing threads (§2.3)', () => {
    at('2024-01-01T00:00:00.000Z', () => decisions.decide(SENDER, 'approved'));
    let verdict = { screenerDecline: true };
    at(T_DECLINE, () => {
      verdict = decisions.decide(SENDER, 'declined');
    });

    // "leaves their existing inbox threads in place and silences future mail"
    expect(decisions.hidden(OLD, SENDER)).toBe(false);
    expect(decisions.hidden(DURING_DECLINE, SENDER)).toBe(true);
    // …and their kept mail is not the Screener kind, so nothing is archived.
    expect(verdict.screenerDecline).toBe(false);
  });

  it('a reply cannot drag a kept thread across the cutoff', () => {
    at('2024-01-01T00:00:00.000Z', () => decisions.decide(SENDER, 'approved'));
    at(T_DECLINE, () => decisions.decide(SENDER, 'declined'));

    // Started before the decline, replied to after: still the same
    // conversation, still kept.
    const replied = thread('replied', '2024-01-10T00:00:00.000Z', '2024-03-15T00:00:00.000Z');
    expect(decisions.hidden(replied, SENDER)).toBe(false);
  });

  it('approving after a decline surfaces nothing older than the reversal (§2.3)', () => {
    at(T_DECLINE, () => decisions.decide(SENDER, 'declined'));
    at(T_APPROVE, () => decisions.decide(SENDER, 'approved'));

    // "reversing a decline only affects mail received after the reversal"
    expect(decisions.hidden(OLD, SENDER)).toBe(true);
    expect(decisions.hidden(DURING_DECLINE, SENDER)).toBe(true);
    expect(decisions.hidden(DURING_APPROVAL, SENDER)).toBe(false);
    expect(decisions.status(SENDER)).toBe('approved');
  });

  /**
   * The defect that survived to the fifth review pass: decline → approve →
   * decline made the sender's oldest mail *visible*, because the second
   * decline saw "previously approved" and kept existing threads — including
   * the ones D7 had already promised were gone. Three decisions, no undo.
   */
  it('D7 survives decline → approve → decline', () => {
    at(T_DECLINE, () => decisions.decide(SENDER, 'declined'));
    at(T_APPROVE, () => decisions.decide(SENDER, 'approved'));
    at(T_DECLINE_2, () => decisions.decide(SENDER, 'declined'));

    expect(decisions.hidden(OLD, SENDER)).toBe(true);
    expect(decisions.hidden(DURING_DECLINE, SENDER)).toBe(true);
    // Mail from the genuinely-approved window is "their existing threads",
    // and the second decline keeps it — where the flags model over-hid.
    expect(decisions.hidden(DURING_APPROVAL, SENDER)).toBe(false);
    expect(decisions.hidden(NEW, SENDER)).toBe(true);
  });

  /**
   * The sentence the flags model got wrong in the other direction: approve →
   * decline → approve surfaced the mail that had arrived *while declined*,
   * because the re-approval saw `keptExisting` and held nothing back.
   */
  it('re-approving does not surface mail that arrived while declined', () => {
    at('2024-01-01T00:00:00.000Z', () => decisions.decide(SENDER, 'approved'));
    at(T_DECLINE, () => decisions.decide(SENDER, 'declined'));
    at(T_APPROVE, () => decisions.decide(SENDER, 'approved'));

    expect(decisions.hidden(OLD, SENDER)).toBe(false);
    expect(decisions.hidden(DURING_DECLINE, SENDER)).toBe(true);
    expect(decisions.hidden(DURING_APPROVAL, SENDER)).toBe(false);
  });

  it('what silence() archived stays archived through any number of decisions', () => {
    at(T_DECLINE, () => decisions.decide(SENDER, 'declined'));
    decisions.addSilenced(SENDER, ['held-1', 'held-2']);
    at(T_APPROVE, () => decisions.decide(SENDER, 'approved'));
    at(T_DECLINE_2, () => decisions.decide(SENDER, 'declined'));
    at('2024-08-01T00:00:00.000Z', () => decisions.decide(SENDER, 'approved'));

    const silenced = thread('held-1', '2024-07-20T00:00:00.000Z');
    expect(decisions.hidden(silenced, SENDER)).toBe(true);
  });

  it('bulk approval closes intervals and keeps silenced lists (O4)', () => {
    at(T_DECLINE, () => decisions.decide(SENDER, 'declined'));
    decisions.addSilenced(SENDER, ['held-1']);
    at(T_APPROVE, () => decisions.bulkApprove([SENDER, 'other@example.com']));

    expect(decisions.status(SENDER)).toBe('approved');
    expect(decisions.status('other@example.com')).toBe('approved');
    // The overwrite bug: bulk approval used to drop everything but status.
    expect(decisions.hidden(thread('held-1', '2024-01-05T00:00:00.000Z'), SENDER)).toBe(true);
    expect(decisions.hidden(DURING_DECLINE, SENDER)).toBe(true);
  });

  it('undo restores the record the decision replaced, and returns its silenced ids', () => {
    at(T_DECLINE, () => decisions.decide(SENDER, 'declined'));
    decisions.addSilenced(SENDER, ['held-1']);
    at(T_APPROVE, () => decisions.decide(SENDER, 'approved'));
    at(T_DECLINE_2, () => decisions.decide(SENDER, 'declined'));
    decisions.addSilenced(SENDER, ['held-2']);

    // Undoing the second decline: only *its* archiving comes back.
    const restore = decisions.undecide(SENDER);
    expect(restore).toEqual(['held-2']);
    expect(decisions.status(SENDER)).toBe('approved');
    // The first decline's history is intact underneath.
    expect(decisions.hidden(DURING_DECLINE, SENDER)).toBe(true);
  });

  it('undoing a first decision returns the sender to the Screener', () => {
    at(T_DECLINE, () => decisions.decide(SENDER, 'declined'));
    decisions.addSilenced(SENDER, ['held-1']);

    expect(decisions.undecide(SENDER)).toEqual(['held-1']);
    expect(decisions.has(SENDER)).toBe(false);
    expect(decisions.hidden(OLD, SENDER)).toBe(false);
  });

  it('undoing a sender nobody decided on is a no-op', () => {
    expect(decisions.undecide(SENDER)).toEqual([]);
  });

  it('survives a reload', () => {
    at(T_DECLINE, () => decisions.decide(SENDER, 'declined'));
    decisions.addSilenced(SENDER, ['held-1']);
    at(T_APPROVE, () => decisions.decide(SENDER, 'approved'));

    const reloaded = SenderDecisions.load('me@example.com');
    expect(reloaded.status(SENDER)).toBe('approved');
    expect(reloaded.hidden(DURING_DECLINE, SENDER)).toBe(true);
    expect(reloaded.hidden(thread('held-1', '2024-05-05T00:00:00.000Z'), SENDER)).toBe(true);
    // And undo still works across the reload — previous is persisted with it.
    reloaded.undecide(SENDER);
    expect(reloaded.status(SENDER)).toBe('declined');
  });

  it('keeps accounts separate', () => {
    at(T_DECLINE, () => decisions.decide(SENDER, 'declined'));
    const other = SenderDecisions.load('someone-else@example.com');
    expect(other.has(SENDER)).toBe(false);
  });

  it('drops records it cannot read rather than guessing', () => {
    localStorage.setItem(
      'pigeon.decisions.me@example.com',
      JSON.stringify({
        [SENDER]: { status: 'declined', keptExisting: true, at: T_DECLINE }, // old flags shape
        'fine@example.com': { status: 'approved', at: T_APPROVE, declined: [] },
      }),
    );
    const loaded = SenderDecisions.load('me@example.com');
    // Back to the Screener — the safe direction to be wrong in.
    expect(loaded.has(SENDER)).toBe(false);
    expect(loaded.status('fine@example.com')).toBe('approved');
  });

  it('is case-insensitive about addresses', () => {
    at(T_DECLINE, () => decisions.decide('Casey@Newsletter.Example', 'declined'));
    expect(decisions.status(SENDER)).toBe('declined');
    expect(decisions.hidden(OLD, 'CASEY@NEWSLETTER.EXAMPLE')).toBe(true);
  });

  it('lists senders by status with when they were decided', () => {
    at(T_DECLINE, () => decisions.decide(SENDER, 'declined', 'Casey'));
    at(T_APPROVE, () => decisions.decide('ok@example.com', 'approved'));

    expect(decisions.list('declined')).toEqual([
      { email: SENDER, name: 'Casey', at: T_DECLINE },
    ]);
    expect(decisions.list('approved')).toEqual([
      { email: 'ok@example.com', name: undefined, at: T_APPROVE },
    ]);
  });
});
