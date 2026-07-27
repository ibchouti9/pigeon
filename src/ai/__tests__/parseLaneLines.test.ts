import { describe, expect, it } from 'vitest';
import { parseLaneLines } from '../prompts';
import { LANES } from '../../data/lanes';

/**
 * The target is a 3B model on someone's laptop. Everything below is a shape a
 * small model actually produces, and the parser's job is to get the answer out
 * of all of them rather than to insist on one.
 */
describe('parseLaneLines', () => {
  it('reads the format the prompt asks for: evidence, then lane', () => {
    const out = parseLaneLines(
      '1: offer with a deadline — promotions\n2: a payment confirmation — receipts',
      LANES,
    );
    expect(out).toEqual([
      { n: 1, lane: 'promotions', why: 'offer with a deadline' },
      { n: 2, lane: 'receipts', why: 'a payment confirmation' },
    ]);
  });

  it('keeps a hyphen inside the evidence rather than splitting on it', () => {
    // "Series B, remote-first" is one phrase. Splitting on the first dash
    // threw half of every recruiter line away.
    expect(parseLaneLines('1: staff engineer, remote-first pitch — promotions', LANES)[0]).toEqual({
      n: 1,
      lane: 'promotions',
      why: 'staff engineer, remote-first pitch',
    });
  });

  it('still reads a model that reverts to naming the lane first', () => {
    expect(parseLaneLines('1: promotions — offer with a deadline', LANES)[0]).toEqual({
      n: 1,
      lane: 'promotions',
      why: 'offer with a deadline',
    });
  });

  it('accepts a plain hyphen where the prompt asked for an em dash', () => {
    expect(parseLaneLines('1: a colleague replying - people', LANES)[0].lane).toBe('people');
  });

  it('accepts a full stop after the number', () => {
    expect(parseLaneLines('1. a build result — notifications', LANES)[0].n).toBe(1);
  });

  it('accepts a line with the lane and no evidence at all', () => {
    expect(parseLaneLines('3: newsletters', LANES)).toEqual([
      { n: 3, lane: 'newsletters', why: '' },
    ]);
  });

  it('survives markdown bold around the number and the lane', () => {
    expect(parseLaneLines('**2**: an invoice — **receipts**', LANES)[0]).toEqual({
      n: 2,
      lane: 'receipts',
      why: 'an invoice',
    });
  });

  it('ignores preamble and closing prose around the answer', () => {
    const out = parseLaneLines(
      "Here are the results:\n\n1: a direct reply — people\n\nLet me know if you'd like more detail.",
      LANES,
    );
    expect(out).toEqual([{ n: 1, lane: 'people', why: 'a direct reply' }]);
  });

  it('drops a lane that does not exist rather than filing a thread nowhere', () => {
    const out = parseLaneLines('1: junk mail — spam\n2: a reply — people', LANES);
    expect(out).toEqual([{ n: 2, lane: 'people', why: 'a reply' }]);
  });

  it('takes the first answer when a model answers the same row twice', () => {
    const out = parseLaneLines('1: a reply — people\n1: actually an ad — promotions', LANES);
    expect(out).toEqual([{ n: 1, lane: 'people', why: 'a reply' }]);
  });

  it('returns nothing for a completion with no answer in it', () => {
    expect(parseLaneLines("I'm not able to sort these emails.", LANES)).toEqual([]);
  });

  it('strips a trailing full stop after the lane', () => {
    expect(parseLaneLines('1: an order confirmation — receipts.', LANES)[0]).toEqual({
      n: 1,
      lane: 'receipts',
      why: 'an order confirmation',
    });
  });

  it('is case-insensitive about the lane name', () => {
    expect(parseLaneLines('1: a reply — People', LANES)[0].lane).toBe('people');
  });

  /*
   * The shapes the live triage run produced, which the end-anchored parser
   * silently dropped — two of twelve senders, gone, with no sign anything had
   * happened.
   */
  it('reads a label followed by a parenthetical', () => {
    expect(parseLaneLines('4: promotions (no subscription)', LANES)[0]).toEqual({
      n: 4,
      lane: 'promotions',
      why: 'no subscription',
    });
  });

  it('takes the last label when the evidence contains one too', () => {
    const out = parseLaneLines('1: reads like people but sent to a list — promotions', LANES);
    expect(out[0].lane).toBe('promotions');
    expect(out[0].why).toBe('reads like people but sent to a list');
  });

  it('works against any vocabulary, not just lanes', () => {
    // The Screener reuses this for approve / decline / unsure.
    const words = ['approve', 'decline', 'unsure'] as const;
    expect(parseLaneLines('2: mail-merged recruiter pitch — decline', words)[0]).toEqual({
      n: 2,
      lane: 'decline',
      why: 'mail-merged recruiter pitch',
    });
  });
});
