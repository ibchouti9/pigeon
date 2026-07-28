import { describe, expect, it } from 'vitest';
import {
  classify,
  isGuess,
  LANES,
  LANE_BLURBS,
  LANE_LABELS,
  threadSignals,
  type LaneSignals,
} from '../lanes';
import type { Thread } from '../../types';

type Over = Omit<Partial<LaneSignals>, 'from'> & { from?: Partial<LaneSignals['from']> };

function signals(over: Over = {}): LaneSignals {
  const { from, ...rest } = over;
  return {
    from: { name: 'Someone', email: 'someone@example.com', ...from },
    subject: '',
    text: '',
    hasReplied: false,
    userInThread: false,
    messageCount: 1,
    ...rest,
  };
}

describe('lane taxonomy', () => {
  it('labels and blurbs cover every lane', () => {
    for (const lane of LANES) {
      expect(LANE_LABELS[lane]).toBeTruthy();
      expect(LANE_BLURBS[lane]).toBeTruthy();
    }
  });

  it('every blurb is one sentence', () => {
    for (const lane of LANES) {
      expect(LANE_BLURBS[lane]).toMatch(/^[A-Z].*\.$/);
      expect(LANE_BLURBS[lane].split('.').filter(Boolean)).toHaveLength(1);
    }
  });
});

describe('people', () => {
  it('a conversation the user is in is a conversation, whatever it says', () => {
    // Subject full of promo wording. Two people are still talking.
    const v = classify(
      signals({
        subject: '50% off — are you going?',
        userInThread: true,
        messageCount: 4,
        from: { email: 'jo@example.com' },
      }),
    );
    expect(v.lane).toBe('people');
    expect(v.confidence).toBeGreaterThan(0.9);
  });

  it('a single message from someone the user has written to is people', () => {
    const v = classify(signals({ hasReplied: true, from: { email: 'sam@acme.io' } }));
    expect(v.lane).toBe('people');
  });

  it('a personal mail host outranks a bare company address', () => {
    expect(classify(signals({ from: { email: 'k@gmail.com' } })).lane).toBe('people');
  });

  it('a no-reply address is never people, even from a personal host', () => {
    const v = classify(signals({ from: { email: 'no-reply@gmail.com' } }));
    expect(v.lane).not.toBe('people');
  });

  it('a List-Unsubscribe header disqualifies people even with a human name', () => {
    const v = classify(
      signals({ from: { name: 'Ada Lovelace', email: 'ada@substack.com' }, listUnsubscribe: true }),
    );
    expect(v.lane).not.toBe('people');
  });
});

describe('receipts', () => {
  it.each([
    'Your order #10482 has shipped',
    'Receipt from Stripe',
    'Invoice 2029-04 is ready',
    'Payment received — thank you',
    'Your booking confirmation for 12 August',
    'Your subscription renews on 1 September',
  ])('%s', (subject) => {
    expect(classify(signals({ subject, from: { email: 'orders@shop.com' } })).lane).toBe('receipts');
  });

  it('outranks promo wording in the same message', () => {
    const v = classify(
      signals({
        subject: 'Your order #55 has shipped',
        text: 'Save 20% on your next purchase with code THANKS',
        from: { email: 'no-reply@shop.com' },
      }),
    );
    expect(v.lane).toBe('receipts');
  });

  it('is less sure when only the body carries it', () => {
    const strong = classify(signals({ subject: 'Your receipt', from: { email: 'billing@x.com' } }));
    const weak = classify(signals({ text: 'a receipt is attached', from: { email: 'billing@x.com' } }));
    expect(weak.confidence).toBeLessThan(strong.confidence);
  });
});

describe('notifications', () => {
  it.each([
    'Security alert: new sign-in from Chrome',
    'Your verification code is 449201',
    'Build failed on main',
    'alice commented on pull request #12',
    'Action required: your card expires soon',
  ])('%s', (subject) => {
    expect(classify(signals({ subject, from: { email: 'notifications@svc.com' } })).lane).toBe(
      'notifications',
    );
  });

  it('a bare no-reply address with nothing to go on lands here', () => {
    const v = classify(signals({ subject: 'Hello', from: { email: 'no-reply@svc.com' } }));
    expect(v.lane).toBe('notifications');
  });
});

describe('promotions', () => {
  it.each([
    '40% off everything this weekend',
    'Flash sale — ends tonight',
    'Free shipping on your next order',
    'Last chance to save',
  ])('%s', (subject) => {
    expect(classify(signals({ subject, from: { email: 'deals@shop.com' } })).lane).toBe('promotions');
  });

  it('a shouting subject is enough to be sure', () => {
    const v = classify(signals({ subject: 'HUGE deals inside!!', from: { email: 'shop@x.com' } }));
    expect(v.lane).toBe('promotions');
    expect(isGuess(v)).toBe(false);
  });
});

describe('newsletters', () => {
  it.each([
    'Issue #42: what happened this week',
    'The weekly roundup',
    'Your daily briefing',
  ])('%s', (subject) => {
    expect(classify(signals({ subject, from: { email: 'news@letter.com' } })).lane).toBe(
      'newsletters',
    );
  });

  it('a person writing to their own list is reading, on the header alone', () => {
    const v = classify(
      signals({ subject: 'Thoughts on caching', from: { email: 'ada@blog.com' }, listUnsubscribe: true }),
    );
    expect(v.lane).toBe('newsletters');
  });

  it('a role address on a list, with no edition wording, is an offer instead', () => {
    const v = classify(
      signals({ subject: 'Introducing our new look', from: { email: 'marketing@shop.com' }, listUnsubscribe: true }),
    );
    expect(v.lane).toBe('promotions');
    expect(isGuess(v)).toBe(true);
  });

  it('an unsubscribe footer is a bulk mark, not evidence of an edition', () => {
    // The exact bug this split fixes: cold outreach carrying an unsubscribe
    // link used to file itself under things the user reads.
    const v = classify(
      signals({
        subject: "You're invited to a 15-minute demo",
        text: 'Our platform helps teams ship faster. Unsubscribe here.',
        from: { name: 'Devon Marsh', email: 'devon@quickpitch.io' },
      }),
    );
    expect(v.lane).toBe('promotions');
  });

  it('an offer in the footer of an edition stays an edition', () => {
    const v = classify(
      signals({
        subject: 'Issue #17',
        text: 'Long piece about compilers. ... Subscribers save 20% on the book.',
        from: { email: 'news@letter.com' },
      }),
    );
    expect(v.lane).toBe('newsletters');
  });
});

describe('confidence', () => {
  it('the same signals always give the same verdict', () => {
    const s = signals({ subject: 'Issue #4', from: { email: 'news@x.com' } });
    expect(classify(s)).toEqual(classify(s));
  });

  it('marks a thread it had nothing to go on as a guess', () => {
    const v = classify(signals({ from: { name: '', email: 'x7f2@mail-1029.net' } }));
    expect(isGuess(v)).toBe(true);
  });

  it('every verdict carries a reason a person could read', () => {
    const cases = [
      signals({ subject: 'Your order shipped' }),
      signals({ subject: '30% off' }),
      signals({ hasReplied: true }),
      signals({ from: { email: 'no-reply@x.com' } }),
    ];
    for (const c of cases) {
      const { why } = classify(c);
      expect(why.length).toBeGreaterThan(8);
      expect(why).toMatch(/^[A-Z]/);
      expect(why).not.toMatch(/[.]$/);
    }
  });
});

/**
 * `LaneSignals.listUnsubscribe` was read at both of the classifier's bulk
 * decisions and written by nothing, so it was `undefined` on every thread in
 * the product and the sort ran on body regexes alone. These pin the wiring
 * rather than the rule — the rule already had tests, against a field only the
 * tests ever set.
 */
describe('the List-Unsubscribe signal reaches the classifier', () => {
  function threadWith(listUnsubscribe: boolean): Thread {
    return {
      id: 't1',
      subject: 'A perfectly ordinary subject',
      place: 'inbox',
      unread: false,
      lastMessageAt: '2026-07-20T10:00:00.000Z',
      messages: [
        {
          id: 'm1',
          threadId: 't1',
          from: { name: 'Rivet', email: 'hello@rivet.app' },
          to: [],
          cc: [],
          subject: 'A perfectly ordinary subject',
          body: 'Nothing here says bulk in words.',
          date: '2026-07-20T10:00:00.000Z',
          attachments: [],
          isFromUser: false,
          listUnsubscribe,
        },
      ],
    };
  }

  it('surfaces the header from the messages', () => {
    expect(threadSignals(threadWith(true), () => false).listUnsubscribe).toBe(true);
    expect(threadSignals(threadWith(false), () => false).listUnsubscribe).toBe(false);
  });

  it('keeps a thread bulk once it carries the header, whatever the body says', () => {
    const bulk = threadSignals(threadWith(true), () => false);
    const plain = threadSignals(threadWith(false), () => false);
    // Same words, same sender, same everything but the header.
    expect(classify(bulk).lane).not.toBe(classify(plain).lane);
  });
});
