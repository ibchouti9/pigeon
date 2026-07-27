/**
 * What Pigeon would do with a held sender, if it were asked.
 *
 * The Screener is the product's whole argument, and it is also the only screen
 * that asks the user to work: twelve strangers, twelve decisions, every week,
 * forever. A one-line read per card helps somebody decide. It does not decide.
 *
 * So this proposes. It never acts — nothing here calls `decideSender`, and no
 * suggestion is applied without the user pressing the button that applies it.
 * That is not caution for its own sake: an approval is reversible in one key
 * and a decline silences somebody permanently, and a product whose entire
 * premise is "you choose who reaches you" cannot start choosing.
 *
 * The evidence is `classify` from `lanes.ts`, which already knows the
 * difference between a person writing by hand and a campaign. A held sender
 * whose only message is confidently a sales blast is the same judgement as a
 * thread confidently in Offers; there is no reason to build it twice.
 */

import type { HeldSender } from '../types';
import { classify, type LaneSignals } from './lanes';

export type Suggestion = 'approve' | 'decline' | 'unsure';

export interface TriageVerdict {
  suggestion: Suggestion;
  /** Shown next to the suggestion. Never a judgement word (§7.9). */
  why: string;
  /** Below `SURE`, the deterministic pass defers to a model if one exists. */
  confidence: number;
}

/** Under this, the rules would rather say nothing than guess at a decline. */
const SURE = 0.8;

/**
 * A held sender's mail, flattened into the shape the lane classifier reads.
 *
 * `hasReplied` is false by definition: a sender in the Screener is one the
 * user has never written to. That is exactly why the Screener is hard, and
 * why the strongest people signal there is is unavailable here.
 */
function signalsFor(held: HeldSender): LaneSignals {
  const newest = held.messages[held.messages.length - 1];
  return {
    from: newest?.from ?? { name: held.sender.name, email: held.sender.email },
    subject: held.messages.map((m) => m.subject).join(' · '),
    text: held.messages.map((m) => m.body ?? '').join('\n').slice(0, 4000),
    hasReplied: false,
    userInThread: false,
    messageCount: held.messages.length,
  };
}

export function triage(held: HeldSender): TriageVerdict {
  const verdict = classify(signalsFor(held));

  /*
   * Only two lanes produce a suggestion, and only when the evidence was strong.
   *
   * Reading and Receipts and Alerts are all deliberately absent. A newsletter
   * you subscribed to and one you were added to look identical from here, an
   * unexpected receipt is often the most important mail of the week, and a
   * security alert from a service you use is the last thing to guess about.
   * Those go to the model, or to the user, and never to a rule.
   */
  if (verdict.lane === 'promotions' && verdict.confidence >= SURE) {
    return { suggestion: 'decline', why: verdict.why, confidence: verdict.confidence };
  }

  if (verdict.lane === 'people' && verdict.confidence >= SURE) {
    return { suggestion: 'approve', why: verdict.why, confidence: verdict.confidence };
  }

  return { suggestion: 'unsure', why: verdict.why, confidence: verdict.confidence };
}

/** Counts for the one line the Screener shows above the list. */
export function tally(verdicts: Map<string, TriageVerdict>): {
  approve: string[];
  decline: string[];
} {
  const approve: string[] = [];
  const decline: string[] = [];
  for (const [id, v] of verdicts) {
    if (v.suggestion === 'approve') approve.push(id);
    else if (v.suggestion === 'decline') decline.push(id);
  }
  return { approve, decline };
}
