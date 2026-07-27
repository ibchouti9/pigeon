/**
 * Lanes — what splits the Inbox.
 *
 * The Screener answers "should this person reach me at all". It says nothing
 * about the mail from the hundreds of senders already approved, which arrives
 * as one undifferentiated column: a friend's reply, a Stripe receipt and a
 * 40%-off email sit in the same list at the same weight. Gmail's answer is five
 * tabs decided by a server nobody can see or correct.
 *
 * A lane is not a folder and not a label. Nothing moves, nothing is filed, and
 * a thread is in exactly one place (§2.1) as it always was — the lane is a
 * derived read over the same list, recomputed from the thread itself. Turning
 * lanes off shows the column Pigeon always showed.
 *
 * This pass is deterministic and runs on every thread with no model connected:
 * it is header-and-wording evidence, not inference. `confidence` is what an
 * assistant pass overrides — a model is asked about the threads this file was
 * unsure of, never about the ones where the evidence already decided.
 */

import type { Address, Thread } from '../types';

export type Lane = 'people' | 'newsletters' | 'promotions' | 'receipts' | 'notifications';

/** Rail order, and the order the chips render in. */
export const LANES: Lane[] = [
  'people',
  'newsletters',
  'promotions',
  'receipts',
  'notifications',
];

export const LANE_LABELS: Record<Lane, string> = {
  people: 'People',
  newsletters: 'Reading',
  promotions: 'Offers',
  receipts: 'Receipts',
  notifications: 'Alerts',
};

/**
 * One line each, shown in the empty state and in Settings. These say what
 * belongs in the lane rather than naming the rule that put it there — the rule
 * is `LaneVerdict.why`, which is per-thread.
 */
export const LANE_BLURBS: Record<Lane, string> = {
  people: 'Mail a person wrote to you.',
  newsletters: 'Things you subscribed to read.',
  promotions: 'Mail that wants to sell you something.',
  receipts: 'Orders, payments, bookings and tickets.',
  notifications: 'Automatic mail from services you use.',
};

/** Everything the pass is allowed to look at. */
export interface LaneSignals {
  from: Address;
  subject: string;
  /** Body text, or the listing's preview line when that is all there is. */
  text: string;
  /** The user has written to this address before. */
  hasReplied: boolean;
  /** The user has written *in this thread*. */
  userInThread: boolean;
  /** How many messages the conversation holds. */
  messageCount: number;
  /** RFC 2369 `List-Unsubscribe` was present. Absent when unknown. */
  listUnsubscribe?: boolean;
  /** `Precedence: bulk|list` or `Auto-Submitted: auto-generated`. */
  bulk?: boolean;
}

export interface LaneVerdict {
  lane: Lane;
  /**
   * 0–1. Below `UNSURE` the assistant pass is allowed to overrule this, and
   * the UI says the thread was sorted on a guess.
   */
  confidence: number;
  /** Why, in the fewest words that are still true. Shown to the user. */
  why: string;
}

/** Under this, a verdict is a guess and an assistant may replace it. */
const UNSURE = 0.6;

const RE = {
  /** Local parts that exist so a human never answers. */
  machineLocal:
    /^(no-?reply|do-?not-?reply|donotreply|notifications?|notify|alerts?|mailer|mail|bounces?|postmaster|automated|auto|system|robot|bot|daemon|noreply)([-._+].*)?$/i,
  /** Local parts a company staffs but rarely writes from personally. */
  roleLocal:
    /^(news|newsletter|updates?|digest|hello|hi|team|info|contact|marketing|offers?|deals?|promo|store|shop|sales|billing|receipts?|invoices?|orders?|support|help|care|service)([-._+].*)?$/i,
  /** VERP and campaign-tool envelope shapes: bounce-1234-abcd@, u=123&id=. */
  campaignLocal: /[-.=+][0-9a-f]{8,}|^\d{6,}$|^[a-z]+-\d{4,}/i,

  /*
   * No trailing `\b` on these alternations. One closing boundary applied to a
   * whole group is a trap: `issue #?\d` inside `\b(…)\b` cannot match "Issue
   * #17", because the boundary has to fall between the "1" and the "7". Same
   * bug swallowed "booking confirmation" and "subscription renews". A leading
   * `\b` is what stops a mid-word match; the closing one mostly just lies.
   */
  receipt:
    /\b(receipt|invoice|order\s*(#|no\.?|number|confirm|placed|update)|your order|payment\s*(received|confirm|succe|failed|due)|you (were|have been) charged|refund|billing statement|statement is ready|booking\s*(confirm|reference)|reservation|itinerary|e-?ticket|boarding pass|has shipped|shipping confirm|out for delivery|tracking (number|info)|has been delivered|renew(s|al|ing)|subscription\s*(renew|charge)|transaction (receipt|confirm|#))/i,
  promo:
    /(\b\d{1,3}\s?% ?off\b|\bsave (up to )?[$£€]?\d|\bsales?\b|\bdeals?\b|\bdiscount|\bcoupon|\bpromo code\b|\bfree shipping\b|\blimited time\b|\blast chance\b|\bends (today|tonight|soon)\b|\bexclusive offer\b|\bshop now\b|\bbuy now\b|\bblack friday\b|\bcyber monday\b|\bflash sale\b|\bclearance\b|\bnew arrivals\b|\bback in stock\b|\bupgrade to (pro|premium|plus)\b|\btry .{0,20}free\b)/i,
  notification:
    /\b(security alert|new sign-?in|signed in|log ?in from|verify your|verification code|confirm your (email|address)|password (reset|changed)|two-?factor|2fa|one-?time (code|password)|your code is|build (failed|passed|succeeded)|deploy(ed|ment)|pipeline|workflow run|pull request|merge request|(opened|closed|reopened|new|comment(ed)? on) issue #\d|commented on|mentioned you|assigned (you|to you)|review requested|calendar|invitation:|declined:|accepted:|reminder:|expires? (in|on|soon)|has expired|action required|usage (limit|alert)|quota|downtime|incident|status update|backup (complete|failed)|storage (is )?(almost )?full)/i,
  /*
   * An edition. Deliberately *not* "unsubscribe": every marketing email carries
   * one, and treating it as newsletter evidence filed a cold sales pitch under
   * Reading. Unsubscribe wording says the mail was sent to a list — which is a
   * reason it is not from a person, and no reason at all to think you read it.
   */
  newsletter:
    /\b(newsletter|weekly (digest|roundup|edition|briefing|read)|daily (digest|briefing|brief)|issue #?\d|vol\.? ?\d|this week'?s? (edition|issue|picks|links)|roundup|digest|latest (issue|edition)|read (it )?online|view (this|in) (email )?(in your )?browser|forwarded this|in this (issue|edition))/i,
  /** Marks of mail sent to a list, whatever the list is for. */
  bulkMarks:
    /\b(unsubscrib|manage (your )?(email )?(preferences|subscription)|update your preferences|you (are|'re) receiving this|opt ?out|sent to you because|no longer wish to receive)/i,
  /** Someone is selling to you personally: outreach, not a campaign. */
  pitch:
    /\b(book (a|some) (call|time|demo)|schedule a (call|demo)|15[- ]minute|quick (call|chat|question)|hop on a call|worth a (chat|conversation)|reaching out (to|about)|following up on my (last )?(email|note)|circling back|touch base|our (platform|solution) (can|helps)|invited to a .{0,20}demo|see it in action|start your (free )?trial|pricing (options|plans))/i,
  /** Marketing writes like this and people do not. */
  shouting: /[A-Z]{4,}|[!]{2,}|[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u,
};

function hit(re: RegExp, ...fields: string[]): boolean {
  return fields.some((f) => re.test(f));
}

/** Domains that are a person's mail host, never a campaign sender. */
const PERSONAL_HOSTS = new Set([
  'gmail.com',
  'googlemail.com',
  'icloud.com',
  'me.com',
  'mac.com',
  'outlook.com',
  'hotmail.com',
  'live.com',
  'yahoo.com',
  'ymail.com',
  'proton.me',
  'protonmail.com',
  'pm.me',
  'fastmail.com',
  'hey.com',
  'aol.com',
  'gmx.com',
  'zoho.com',
  'tutanota.com',
  'duck.com',
]);

function parts(email: string): { local: string; domain: string } {
  const at = email.lastIndexOf('@');
  if (at < 0) return { local: email.toLowerCase(), domain: '' };
  return { local: email.slice(0, at).toLowerCase(), domain: email.slice(at + 1).toLowerCase() };
}

/**
 * Does this look like it came out of a person's hands?
 *
 * Two people going back and forth is the strongest evidence there is, and it
 * is evidence no wording test can produce: a receipt never gets a reply.
 */
function humanEvidence(s: LaneSignals): { score: number; why: string } | null {
  if (s.userInThread && s.messageCount > 1) {
    return { score: 0.98, why: 'You and they are talking' };
  }
  const { local, domain } = parts(s.from.email);
  const machine = RE.machineLocal.test(local) || RE.roleLocal.test(local) || RE.campaignLocal.test(local);
  if (machine) return null;

  if (s.listUnsubscribe || s.bulk || RE.bulkMarks.test(s.text)) return null;

  if (s.hasReplied) return { score: 0.9, why: 'You have written to them before' };
  if (PERSONAL_HOSTS.has(domain)) return { score: 0.8, why: 'A personal address, written by hand' };
  // A named human at a company domain, no bulk markers, no campaign wording.
  if (s.from.name && /\s/.test(s.from.name.trim()) && !RE.shouting.test(s.from.name)) {
    return { score: 0.66, why: 'A named sender, with none of the marks of bulk mail' };
  }
  return { score: 0.55, why: 'Nothing here says it was sent to a list' };
}

/**
 * The one pass. Pure: same signals, same verdict, on every machine and in
 * every test.
 */
export function classify(s: LaneSignals): LaneVerdict {
  const subject = s.subject ?? '';
  const text = (s.text ?? '').slice(0, 4000);
  const { local } = parts(s.from.email);

  const human = humanEvidence(s);
  if (human && human.score >= 0.8) {
    return { lane: 'people', confidence: human.score, why: human.why };
  }

  // Receipts first: a receipt from a shop says "order" and "your purchase",
  // and every promo test in the file would also match it. Money that has
  // already moved outranks money someone wants to move.
  if (hit(RE.receipt, subject, text)) {
    const strong = hit(RE.receipt, subject);
    return {
      lane: 'receipts',
      confidence: strong ? 0.9 : 0.68,
      why: strong ? 'The subject is about an order or a payment' : 'Reads like a record of a payment',
    };
  }

  // Then the machine-to-you mail that isn't selling: codes, alerts, builds.
  if (hit(RE.notification, subject, text)) {
    const strong = hit(RE.notification, subject);
    return {
      lane: 'notifications',
      confidence: strong ? 0.88 : 0.66,
      why: strong ? 'An automatic alert from a service' : 'Mentions an automatic alert',
    };
  }

  const promo = hit(RE.promo, subject, text) || hit(RE.pitch, subject, text);
  const news = hit(RE.newsletter, subject, text);
  const bulk = s.listUnsubscribe === true || s.bulk === true || RE.bulkMarks.test(text);

  if (promo && !hit(RE.promo, subject) && !hit(RE.pitch, subject) && news) {
    // Offer wording buried in the footer of something that is an edition.
    return { lane: 'newsletters', confidence: 0.7, why: 'A subscription you read, with an offer at the bottom' };
  }

  if (promo) {
    const strong = hit(RE.promo, subject) || hit(RE.pitch, subject) || RE.shouting.test(subject);
    return {
      lane: 'promotions',
      confidence: strong ? 0.86 : 0.64,
      why: strong ? 'The subject is selling something' : 'Sales wording in the body',
    };
  }

  if (news) {
    const strong = hit(RE.newsletter, subject) || RE.roleLocal.test(local);
    return {
      lane: 'newsletters',
      confidence: strong ? 0.82 : 0.64,
      why: strong ? 'Reads like a regular edition' : 'Mentions an edition somewhere in it',
    };
  }

  /*
   * Sent to a list, and nothing in it says what kind of list.
   *
   * Who signed it is the tiebreak. A person's name in the local part, writing
   * at length, is how every independent newsletter on the internet arrives —
   * Substack, Ghost, a `mailto:` and a text file. A role address with no
   * edition wording is a campaign.
   *
   * Offers, not Alerts, when it falls through: Alerts is where you go for a
   * sign-in code at the moment you need one, and it is worth more kept clean
   * than kept complete. Low confidence either way, which is exactly what makes
   * these the threads an assistant pass is asked about.
   */
  if (bulk) {
    const authored = !RE.roleLocal.test(local) && !RE.campaignLocal.test(local);
    if (authored || text.length > 1200) {
      return {
        lane: 'newsletters',
        confidence: 0.62,
        why: authored ? 'A person writing to a list they run' : 'Long enough to be something you read',
      };
    }
    return { lane: 'promotions', confidence: 0.45, why: 'Sent to a list, with nothing saying what for' };
  }

  if (RE.machineLocal.test(local)) {
    return { lane: 'notifications', confidence: 0.72, why: 'From an address that never takes a reply' };
  }

  if (RE.roleLocal.test(local) || RE.campaignLocal.test(local)) {
    return { lane: 'notifications', confidence: 0.5, why: 'From a company address rather than a person' };
  }

  if (human) return { lane: 'people', confidence: human.score, why: human.why };

  return { lane: 'notifications', confidence: 0.4, why: 'Nothing in it says who it is for' };
}

/** True when the verdict is a guess the user should be able to see and fix. */
export function isGuess(v: LaneVerdict): boolean {
  return v.confidence < UNSURE;
}

/** Shape both lanes and the classifier agree on, for anything that stores one. */
export interface LaneAssignment extends LaneVerdict {
  /** Where the verdict came from. A user's own choice is never overwritten. */
  source: 'rules' | 'assistant' | 'user';
}

/**
 * Who a row is from. The newest message is very often the user's own reply, so
 * the newest message that *isn't* is the one that names the conversation —
 * the same rule the engine's `preview_uid` follows.
 */
export function threadSender(thread: Thread): Address {
  const messages = thread.messages ?? [];
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (!messages[i].isFromUser) return messages[i].from;
  }
  return messages[messages.length - 1]?.from ?? { name: '', email: '' };
}

/**
 * A thread's evidence, in the shape `classify` reads.
 *
 * `hasReplied` comes from outside because a thread does not know it: the user
 * may have written to this address for a decade in conversations that aren't
 * this one, and that is the single strongest people signal there is.
 *
 * A listing's `preview` row carries one synthetic message holding the preview
 * line, and this is written to work on exactly that much. Bodies sharpen the
 * verdict; they were never required for one.
 */
export function threadSignals(
  thread: Thread,
  hasReplied: (email: string) => boolean,
): LaneSignals {
  const messages = thread.messages ?? [];
  const from = threadSender(thread);
  return {
    from,
    subject: thread.subject ?? '',
    // Newest first: a long thread's oldest message is the least useful 4k.
    text: messages
      .slice()
      .reverse()
      .map((m) => m.body ?? '')
      .join('\n')
      .slice(0, 4000),
    hasReplied: hasReplied(from.email),
    userInThread: messages.some((m) => m.isFromUser),
    messageCount: thread.messageCount ?? messages.length,
  };
}
