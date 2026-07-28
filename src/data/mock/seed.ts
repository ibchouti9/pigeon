/**
 * The demo account. Everything here is fictional.
 *
 * Pigeon ships with a working demo so the product can be run, reviewed and
 * tested without Google credentials. Dates are computed relative to load time
 * so the inbox always looks current.
 */

import type { Address, KnownReason, Message, Sender, Thread } from '../../types';

export const DEMO_ACCOUNT = {
  email: 'marc@ferrum.dev',
  name: 'Marc Ferrum',
};

const USER: Address = { name: 'Marc Ferrum', email: 'marc@ferrum.dev' };

function at(daysAgo: number, hour: number, minute = 0): string {
  const now = new Date();
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  d.setHours(hour, minute, 0, 0);

  // Run the demo at 9am and a message seeded for 2pm today would be dated in
  // the future, which reads as "just now" everywhere. Pull anything ahead of
  // now back into the last half hour, keeping the seeded order intact.
  if (d.getTime() > now.getTime()) {
    d.setTime(now.getTime() - (24 - hour) * 60_000);
  }

  return d.toISOString();
}

/** Deterministic PRNG so the demo account is identical on every load. */
function mulberry32(seed: number) {
  return function next() {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Named people — the ones who appear in threads.
// ---------------------------------------------------------------------------

interface Person extends Address {
  reason: KnownReason;
  replyCount?: number;
}

const PEOPLE: Person[] = [
  { name: 'Dana Whitlock', email: 'dana@lumenpartners.com', reason: 'replies', replyCount: 24 },
  { name: 'Sana Sethi', email: 'sana@northbound.io', reason: 'replies', replyCount: 11 },
  { name: 'Jae Doss', email: 'jae@doss-studio.com', reason: 'replies', replyCount: 31 },
  { name: 'Priya Raman', email: 'priya@atlasgrid.dev', reason: 'replies', replyCount: 47 },
  { name: 'Tomas Brandt', email: 'tomas.brandt@keelworks.de', reason: 'replies', replyCount: 8 },
  { name: 'Nadia Okonjo', email: 'nadia@okonjo.legal', reason: 'contact' },
  { name: 'Ellis Vance', email: 'ellis@vancebooks.org', reason: 'replies', replyCount: 5 },
  { name: 'Marc Ferrum jr', email: 'marc.jr@ferrum.dev', reason: 'contact' },
  { name: 'Ines Carvalho', email: 'ines@carvalho-arq.pt', reason: 'replies', replyCount: 16 },
  { name: 'Bo Lindqvist', email: 'bo@lindqvist.se', reason: 'contact' },
  { name: 'Ruth Okafor', email: 'ruth@meridianhealth.org', reason: 'replies', replyCount: 3 },
  { name: 'Atlas CI', email: 'noreply@atlas-ci.com', reason: 'contact' },
  { name: 'Kenji Aoki', email: 'kenji@aoki.dev', reason: 'replies', replyCount: 19 },
  { name: 'Lena Fischer', email: 'lena@fischerlaw.de', reason: 'replies', replyCount: 6 },

  /*
   * Not people — the rest of what lands in a real inbox, and the reason lanes
   * exist. A demo made only of correspondence shows one chip and proves
   * nothing: the whole claim is that a Stripe receipt, a Substack issue and a
   * 30%-off email are three different kinds of thing, and Pigeon can tell.
   */
  { name: 'Stripe', email: 'receipts@stripe.com', reason: 'contact' },
  { name: 'Nordvik Rail', email: 'no-reply@nordvikrail.se', reason: 'contact' },
  { name: 'Ben Kuhn', email: 'ben@benkuhn.net', reason: 'contact' },
  { name: 'The Diff', email: 'byrne@thediff.co', reason: 'contact' },
  { name: 'Rivet', email: 'hello@rivet.app', reason: 'contact' },
  { name: 'Kavelle', email: 'marketing@kavelle.com', reason: 'contact' },
  { name: 'GitHub', email: 'notifications@github.com', reason: 'contact' },
  { name: '1Password', email: 'no-reply@1password.com', reason: 'contact' },
];

const P = Object.fromEntries(PEOPLE.map((p) => [p.email, p])) as Record<string, Person>;

const dana = P['dana@lumenpartners.com'];
const sana = P['sana@northbound.io'];
const jae = P['jae@doss-studio.com'];
const priya = P['priya@atlasgrid.dev'];
const tomas = P['tomas.brandt@keelworks.de'];
const nadia = P['nadia@okonjo.legal'];
const ellis = P['ellis@vancebooks.org'];
const marcJr = P['marc.jr@ferrum.dev'];
const ines = P['ines@carvalho-arq.pt'];
const ruth = P['ruth@meridianhealth.org'];
const atlasCi = P['noreply@atlas-ci.com'];
const kenji = P['kenji@aoki.dev'];
const lena = P['lena@fischerlaw.de'];
const stripe = P['receipts@stripe.com'];
const nordvik = P['no-reply@nordvikrail.se'];
const benKuhn = P['ben@benkuhn.net'];
const theDiff = P['byrne@thediff.co'];
const rivet = P['hello@rivet.app'];
const kavelle = P['marketing@kavelle.com'];
const github = P['notifications@github.com'];
const onePassword = P['no-reply@1password.com'];

// ---------------------------------------------------------------------------
// Thread construction helpers
// ---------------------------------------------------------------------------

interface MessageSeed {
  from: Address;
  to?: Address[];
  cc?: Address[];
  body: string;
  quoted?: string;
  date: string;
  /**
   * RFC 2369 `List-Unsubscribe`. Set on the senders that would really carry
   * it, so the demo exercises the same evidence the lane classifier uses on a
   * real account rather than falling through to matching words in the body.
   */
  listUnsubscribe?: boolean;
  /**
   * The message as its sender designed it. Real receipts, newsletters and
   * booking confirmations are HTML; a demo made entirely of plain text
   * showed none of what C-8 renders, and made the reader look like a
   * different product from the one a real account gets.
   */
  bodyHtml?: string;
  attachments?: { filename: string; size: number; mimeType: string }[];
}

let threadCounter = 0;
let messageCounter = 0;

function thread(
  subject: string,
  place: 'inbox' | 'archive',
  unread: boolean,
  seeds: MessageSeed[],
  extra: { approvedAt?: string } = {},
): Thread {
  const id = `t${++threadCounter}`;
  const messages: Message[] = seeds.map((s) => ({
    id: `m${++messageCounter}`,
    threadId: id,
    from: s.from,
    to: s.to ?? [USER],
    cc: s.cc ?? [],
    subject,
    body: s.body.trim(),
    quoted: s.quoted?.trim(),
    date: s.date,
    listUnsubscribe: s.listUnsubscribe,
    bodyHtml: s.bodyHtml,
    attachments: (s.attachments ?? []).map((a, i) => ({
      id: `a${messageCounter}-${i}`,
      ...a,
    })),
    isFromUser: s.from.email === USER.email,
  }));
  return {
    id,
    subject,
    place,
    unread,
    messages,
    lastMessageAt: messages[messages.length - 1].date,
    approvedAt: extra.approvedAt,
  };
}

// ---------------------------------------------------------------------------
// Inbox
// ---------------------------------------------------------------------------

export function buildInboxThreads(): Thread[] {
  return [
    thread('Contract redlines back from legal', 'inbox', true, [
      {
        from: dana,
        cc: [sana],
        date: at(4, 9, 14),
        body: `Marc — legal came back on the MSA. Three changes, one of which I think you'll want to push on.

The liability cap moved from $1M to $500K. They also added a 30-day cure period on termination, and struck the clause about our tooling staying ours.

Redline attached. Sana is copied so she has the context on her side.`,
        attachments: [
          { filename: 'MSA-v4-redline.pdf', size: 245_760, mimeType: 'application/pdf' },
        ],
      },
      {
        from: USER,
        to: [dana],
        cc: [sana],
        date: at(4, 11, 40),
        body: `Thanks — reading now. Will come back with a position on the cap by end of day.`,
      },
      {
        from: sana,
        to: [dana, USER],
        date: at(3, 16, 22),
        body: `The cure period is standard for us, no objection there. The tooling clause is the one I'd fight — that's the whole reason we structured it this way.`,
        quoted: `> Redline attached. Sana is copied so she has the context on her side.`,
      },
      {
        from: dana,
        cc: [sana],
        date: at(0, 14, 14),
        body: `Any movement on the cap? I need your answer before Friday to get this signed this quarter.

Happy to take 750 as a middle if 1M is a hard no for them.`,
      },
    ]),

    thread('Re: Q3 invoice', 'inbox', false, [
      {
        from: USER,
        to: [marcJr],
        date: at(6, 15, 30),
        body: `Invoice for Q3 attached. Same terms as last time — net 30.`,
        attachments: [
          { filename: 'ferrum-q3-invoice.pdf', size: 88_400, mimeType: 'application/pdf' },
        ],
      },
      {
        from: marcJr,
        date: at(5, 10, 12),
        body: `Got it. Passing to finance today.`,
      },
      {
        from: marcJr,
        date: at(0, 9, 47),
        body: `Finance says it's scheduled for the 3rd. Sorry for the wait on our side.`,
        attachments: [
          { filename: 'remittance-advice.pdf', size: 41_200, mimeType: 'application/pdf' },
        ],
      },
    ]),

    thread('Re: office keys', 'inbox', false, [
      {
        from: jae,
        date: at(1, 16, 31),
        body: `Left the spare set with the front desk under your name. They close at 6.`,
      },
    ]),

    thread('Deployment failed: atlasgrid-api #4471', 'inbox', true, [
      {
        from: atlasCi,
        date: at(0, 8, 3),
        body: `Build #4471 failed on main.

  Step: integration-tests
  Failure: 2 of 318 tests failed
    · billing/reconcile_test.go:212 — expected 3 entries, got 2
    · billing/reconcile_test.go:288 — timeout after 30s

  Commit: 8f2c1ae "narrow the reconcile window to a single day"
  Author: priya@atlasgrid.dev

View the full log in Atlas CI.`,
      },
    ]),

    // Carries the arrival ring (§4.2 #4): the first message since this sender
    // was approved. Sana Sethi is deliberately not pre-seeded here — she waits
    // in the Screener so approving her demonstrates the actual arrival.
    thread('Reconcile window change — my fault', 'inbox', true, [
      {
        from: priya,
        date: at(0, 8, 41),
        body: `Saw the CI failure. That's mine — I narrowed the reconcile window to a single day and the fixtures span two.

Fixing the fixtures rather than widening the window back, since the narrow window is the behaviour we actually want. Should be green in an hour.`,
      },
      {
        from: priya,
        date: at(0, 10, 9),
        body: `Green. Also added a case that would have caught this.`,
      },
    ], { approvedAt: at(0, 8, 30) }),

    thread('Keelworks — scope for the second phase', 'inbox', false, [
      {
        from: tomas,
        date: at(9, 10, 0),
        body: `Marc, we've been happy with phase one. Internally we're now talking about a second phase covering the warehouse side.

Nothing is decided, but I wanted to know whether you'd have capacity in the autumn before we take it further.`,
      },
      {
        from: USER,
        to: [tomas],
        date: at(8, 9, 15),
        body: `Good to hear. Autumn is realistic — I'd want to be careful about committing before I see the shape of it.

Can you send whatever internal notes exist, even rough ones?`,
      },
      {
        from: tomas,
        date: at(2, 13, 45),
        body: `Rough notes attached. Warning: they are rough.

The short version is three warehouses, two of which run software from 2011, and a strong preference for not replacing it.`,
        attachments: [
          { filename: 'phase-2-notes.md', size: 12_900, mimeType: 'text/markdown' },
        ],
      },
    ]),

    thread('Your speaking slot — confirming the date', 'inbox', false, [
      {
        from: ellis,
        date: at(3, 11, 20),
        body: `We have you down for the Thursday afternoon session. 40 minutes including questions.

Can you confirm the title? The programme goes to print on the 12th.`,
      },
    ]),

    thread('Studio move — new address from the 1st', 'inbox', false, [
      {
        from: jae,
        date: at(7, 9, 5),
        body: `We're moving two streets over at the end of the month. New address:

  Doss Studio
  14 Ferrier Lane
  Unit 3

Post sent to the old address after the 1st will not reach us.`,
      },
    ]),

    thread('Plans revision 3', 'inbox', false, [
      {
        from: ines,
        date: at(11, 14, 30),
        body: `Third revision attached. The stair moved again — the structural engineer was right and I was wrong.`,
        attachments: [
          { filename: 'plans-rev3.pdf', size: 3_145_728, mimeType: 'application/pdf' },
        ],
      },
      {
        from: USER,
        to: [ines],
        date: at(10, 18, 2),
        body: `This reads much better. One question: is the landing wide enough for the door to swing?`,
      },
      {
        from: ines,
        date: at(10, 19, 40),
        body: `It is, by 60mm. Tight but legal.`,
      },
      {
        from: USER,
        to: [ines],
        date: at(9, 8, 30),
        body: `Then I'm happy. Proceed.`,
      },
      {
        from: ines,
        date: at(5, 11, 15),
        body: `Submitted for approval this morning. Six to eight weeks is the current estimate.`,
      },
    ]),

    thread('Appointment on the 14th', 'inbox', false, [
      {
        from: ruth,
        date: at(12, 8, 45),
        body: `Confirming your appointment on the 14th at 10:20. Please arrive ten minutes early.

If you need to change it, reply to this message rather than calling — the line is busy in the mornings.`,
      },
    ]),

    thread('Re: that library you mentioned', 'inbox', false, [
      {
        from: kenji,
        date: at(14, 22, 10),
        body: `Tried it on the parser. It's fine but the error messages are genuinely bad — you get a byte offset and nothing else.

Ended up writing 40 lines to map offsets back to line and column, which rather defeats the point.`,
      },
      {
        from: USER,
        to: [kenji],
        date: at(13, 7, 55),
        body: `That matches my experience. I kept it anyway because everything else was worse.`,
      },
    ]),

    thread('Signed and returned', 'inbox', false, [
      {
        from: nadia,
        date: at(16, 15, 0),
        body: `Countersigned copy attached for your records. Nothing further needed from you.`,
        attachments: [
          { filename: 'engagement-countersigned.pdf', size: 190_400, mimeType: 'application/pdf' },
        ],
      },
    ]),

    // ---- Receipts ----------------------------------------------------------
    thread('Your receipt from Atlasgrid — €248.00', 'inbox', true, [
      {
        from: stripe,
        date: at(0, 6, 12),
        body: `Receipt #2471-0093

Atlasgrid Cloud, Team plan
€248.00 paid on Visa ending 4419.

This is an automatic receipt. Nothing is owed.`,
        bodyHtml: `<div style="font-family:-apple-system,sans-serif;max-width:520px">
  <p style="font-size:12px;letter-spacing:0.08em;text-transform:uppercase;color:#6B7280;margin:0 0 4px">Receipt #2471-0093</p>
  <h2 style="margin:0 0 16px;font-size:22px;color:#111827">€248.00 paid</h2>
  <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:14px">
    <tr>
      <td style="padding:10px 0;border-bottom:1px solid #E5E7EB;color:#6B7280">Atlasgrid Cloud, Team plan</td>
      <td align="right" style="padding:10px 0;border-bottom:1px solid #E5E7EB;color:#111827">€248.00</td>
    </tr>
    <tr>
      <td style="padding:10px 0;border-bottom:1px solid #E5E7EB;color:#6B7280">VAT (0%)</td>
      <td align="right" style="padding:10px 0;border-bottom:1px solid #E5E7EB;color:#111827">€0.00</td>
    </tr>
    <tr>
      <td style="padding:10px 0;font-weight:600;color:#111827">Total</td>
      <td align="right" style="padding:10px 0;font-weight:600;color:#111827">€248.00</td>
    </tr>
  </table>
  <p style="font-size:13px;color:#6B7280;margin:16px 0 0">Paid on Visa ending 4419. This is an automatic receipt — nothing is owed.</p>
</div>`,
      },
    ]),

    thread('Booking confirmation — Stockholm to Gothenburg, 4 Aug', 'inbox', false, [
      {
        from: nordvik,
        date: at(1, 18, 40),
        body: `Your booking is confirmed.

Departs Stockholm Central 07:14, arrives Gothenburg 10:22. Coach 4, seat 31A.
Booking reference NVK-8823PL.

Show this email or your reference at the barrier.`,
      },
    ]),

    // ---- Reading -----------------------------------------------------------
    thread('The Diff — Issue #412: the storage tier nobody priced', 'inbox', true, [
      {
        from: theDiff,
        date: at(0, 7, 5),
        listUnsubscribe: true,
        body: `In this issue: why three of the four big cloud vendors quietly repriced cold storage in the same quarter, and what that says about where the margin actually is.

The short version is that the tier was never about storage. It was about the egress you pay to find out what is in it.

Read online. Unsubscribe at any time.`,
      },
    ]),

    thread('Some things I got wrong about caching', 'inbox', false, [
      {
        from: benKuhn,
        date: at(2, 20, 15),
        listUnsubscribe: true,
        body: `I wrote last year that the hard part of caching is invalidation. Having spent a year on it, I think that framing is wrong, or at least badly incomplete.

The hard part is that a cache is a second source of truth you did not mean to create, and every bug you will have is really a disagreement between the two.

Three cases where I got this wrong, at length, below.

You are receiving this because you subscribed. Unsubscribe.`,
      },
    ]),

    // ---- Offers ------------------------------------------------------------
    thread('30% off annual — ends tonight', 'inbox', true, [
      {
        from: rivet,
        date: at(0, 8, 30),
        listUnsubscribe: true,
        bodyHtml: `<div style="font-family:-apple-system,sans-serif;max-width:520px;text-align:center">
  <div style="background:linear-gradient(135deg,#4F46E5,#9333EA);border-radius:8px;padding:36px 20px;color:#fff">
    <div style="font-size:34px;font-weight:700;letter-spacing:-0.02em">30% off</div>
    <div style="font-size:15px;opacity:0.9;margin-top:4px">every annual plan</div>
  </div>
  <h1 style="font-size:22px;margin:20px 0 8px;color:#111827">Ends tonight</h1>
  <p style="font-size:15px;color:#4B5563;margin:0 0 20px">Ends tonight at midnight. Upgrade to Pro and keep your current seat count.</p>
  <a href="https://rivet.app/upgrade" style="display:inline-block;background:#4F46E5;color:#fff;padding:12px 28px;border-radius:6px;text-decoration:none;font-weight:600">Upgrade to Pro</a>
  <p style="font-size:12px;color:#9CA3AF;margin:24px 0 0">
    <a href="https://rivet.app/unsubscribe" style="color:#9CA3AF">Unsubscribe</a> ·
    <a href="https://rivet.app/prefs" style="color:#9CA3AF">Manage your preferences</a>
  </p>
  <img src="https://track.rivet.app/open.gif?u=marc" width="1" height="1" alt="">
</div>`,
        body: `Last chance. 30% off every annual plan, until midnight.

Upgrade to Pro and keep your current seat count.

Unsubscribe | Manage your preferences`,
      },
    ]),

    thread('New in Kavelle this month', 'inbox', false, [
      {
        from: kavelle,
        date: at(3, 11, 0),
        listUnsubscribe: true,
        body: `A quick look at what shipped.

Faster exports, a rebuilt settings screen, and a new keyboard layer.

You are receiving this because you have a Kavelle account. Unsubscribe.`,
      },
    ]),

    // ---- Alerts ------------------------------------------------------------
    thread('[atlasgrid/api] priya-raman commented on pull request #218', 'inbox', true, [
      {
        from: github,
        date: at(0, 8, 55),
        body: `priya-raman commented on pull request #218:

"Left one note on the retry budget — otherwise this reads fine to me."

View it on GitHub. You are receiving this because you were mentioned.`,
      },
    ]),

    thread('New sign-in to your 1Password account', 'inbox', false, [
      {
        from: onePassword,
        date: at(2, 7, 20),
        body: `A new sign-in was recorded.

Safari on macOS, Stockholm, Sweden.

If this was you, nothing to do. If it was not, change your password immediately.`,
      },
    ]),

    thread('Question about clause 7', 'inbox', false, [
      {
        from: lena,
        date: at(20, 10, 30),
        body: `Clause 7 as drafted makes you responsible for their data retention obligations. That is unusual and I would not accept it.

Suggested replacement text is in the attached.`,
        attachments: [
          { filename: 'clause-7-alternative.docx', size: 24_800, mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
        ],
      },
      {
        from: USER,
        to: [lena],
        date: at(19, 9, 0),
        body: `Sent it over. Will let you know what comes back.`,
      },
    ]),
  ];
}

// ---------------------------------------------------------------------------
// Archive
// ---------------------------------------------------------------------------

export function buildArchiveThreads(): Thread[] {
  return [
    thread('Kickoff notes — Atlas integration', 'archive', false, [
      {
        from: priya,
        date: at(28, 9, 30),
        body: `Notes from this morning. The main decision: we're not touching the legacy billing tables, we're reading from the replica.`,
      },
      {
        from: USER,
        to: [priya],
        date: at(28, 14, 0),
        body: `Agreed. Anything that writes to those tables is out of scope.`,
      },
    ]),
    thread('Welcome to Atlas CI', 'archive', false, [
      {
        from: atlasCi,
        date: at(45, 12, 0),
        body: `Your account is active. Builds run on push to any branch.`,
      },
    ]),
    thread('Re: rescheduling Tuesday', 'archive', false, [
      {
        from: jae,
        date: at(38, 8, 20),
        body: `Tuesday no longer works — can we do Wednesday same time?`,
      },
      {
        from: USER,
        to: [jae],
        date: at(38, 8, 35),
        body: `Wednesday is fine.`,
      },
    ]),
    thread('Invoice paid', 'archive', false, [
      {
        from: tomas,
        date: at(52, 11, 10),
        body: `Payment went out this morning. Should be with you in two working days.`,
      },
    ]),
    thread('Photos from the site visit', 'archive', false, [
      {
        from: ines,
        date: at(60, 16, 45),
        body: `Twenty-odd photos from this morning. The damp on the north wall is worse than it looked from the drawings.`,
        attachments: [
          { filename: 'site-visit-photos.zip', size: 18_874_368, mimeType: 'application/zip' },
        ],
      },
    ]),
    thread('Reading list', 'archive', false, [
      {
        from: kenji,
        date: at(74, 21, 30),
        body: `The three I mentioned, in the order I'd read them. The middle one is the only essential.`,
      },
    ]),
    thread('Conference schedule — first draft', 'archive', false, [
      {
        from: ellis,
        date: at(88, 10, 0),
        body: `First draft of the schedule. You're on Thursday, subject to change.`,
        attachments: [
          { filename: 'schedule-draft.pdf', size: 156_000, mimeType: 'application/pdf' },
        ],
      },
    ]),
    thread('Engagement letter', 'archive', false, [
      {
        from: nadia,
        date: at(96, 13, 15),
        body: `Engagement letter attached. Sign the last page and return at your convenience.`,
        attachments: [
          { filename: 'engagement-letter.pdf', size: 172_000, mimeType: 'application/pdf' },
        ],
      },
    ]),
  ];
}

// ---------------------------------------------------------------------------
// The Screener — 12 senders held.
//
// These used to carry a hand-written category each, so the demo's digest
// sentence would add up. The digest is gone: the Screener says what Pigeon
// would do with each sender now, and that comes from reading them rather than
// from a fixture. The variety of senders is still deliberate — a warm intro,
// two recruiters (one personal, one mail-merged), three newsletters, cold
// sales, and outright junk — because that spread is what the triage pass has
// to get right.
// ---------------------------------------------------------------------------

interface HeldSeed {
  name: string;
  email: string;
  messages: { subject: string; body: string; daysAgo: number; hour: number }[];
}

const HELD_SEEDS: HeldSeed[] = [
  {
    name: 'Sana Sethi',
    email: 'sana@northbound.io',
    messages: [
      {
        subject: 'Intro to the Atlas team',
        daysAgo: 0,
        hour: 11,
        body: `Hi Marc — Dana suggested I reach out about the integration work.

We're standing up a connection between Atlas and our billing side and it's squarely the sort of thing you do. Would a 30-minute call next week be useful?`,
      },
    ],
  },
  {
    name: 'Talia Brooks',
    email: 'talia.brooks@vertexsearch.com',
    messages: [
      {
        subject: 'Staff Engineer — Series B, remote-first',
        daysAgo: 1,
        hour: 9,
        body: `Marc,

I'm working with a Series B company building payments infrastructure. Staff level, fully remote, comp in the range you'd expect.

Your background in integration work is exactly what they've been struggling to find. Open to a conversation?`,
      },
      {
        subject: 'Following up',
        daysAgo: 0,
        hour: 8,
        body: `Just floating this back to the top of your inbox in case it got buried.`,
      },
    ],
  },
  {
    name: 'Devon Ricci',
    email: 'devon@harborlane-talent.com',
    messages: [
      {
        subject: 'Contract role, 6 months, immediate start',
        daysAgo: 2,
        hour: 14,
        body: `Hi Marc, I have a six-month contract that starts immediately. Fintech, distributed team, extension likely.

Are you available? Day rate is negotiable for the right person.`,
      },
    ],
  },
  {
    name: 'Northbound Digest',
    email: 'digest@northbound-media.com',
    messages: [
      {
        subject: 'Weekly roundup #48',
        daysAgo: 1,
        hour: 6,
        body: `This week: three funding rounds, one acquisition, and the usual arguments about developer productivity.

Read the full issue online.`,
      },
    ],
  },
  {
    name: 'QuickPitch',
    email: 'hello@quickpitch.io',
    messages: [
      {
        subject: "You're invited to a 15-minute demo",
        daysAgo: 2,
        hour: 10,
        body: `Marc — teams like yours are cutting their sales cycle by 40% with QuickPitch.

Fifteen minutes is all it takes. Here are three times that work this week.`,
      },
    ],
  },
  {
    name: 'Meridian Cloud',
    email: 'billing-notice@meridian-cloud-services.net',
    messages: [
      {
        subject: 'Action required: verify your billing details',
        daysAgo: 3,
        hour: 3,
        body: `Your account requires verification within 24 hours to avoid interruption.

Click the link below to confirm your payment method.`,
      },
    ],
  },
  {
    name: 'The Founder Letter',
    email: 'letters@founderletter.co',
    messages: [
      {
        subject: 'The one metric that actually matters',
        daysAgo: 3,
        hour: 7,
        body: `Most founders track the wrong thing. Here's what to track instead, and why it took me nine years to work it out.`,
      },
    ],
  },
  {
    name: 'DevTools Weekly',
    email: 'noreply@devtoolsweekly.com',
    messages: [
      {
        subject: 'Issue 212: the state of build tools',
        daysAgo: 4,
        hour: 6,
        body: `Everything is faster and nothing is simpler. Issue 212 covers the four new build tools released since issue 211.`,
      },
    ],
  },
  {
    name: 'Apex Growth',
    email: 'growth@apex-outbound.com',
    messages: [
      {
        subject: 'Quick question, Marc',
        daysAgo: 4,
        hour: 11,
        body: `Noticed you work with integration-heavy clients. We help consultancies like yours book 3x more discovery calls.

Worth a chat?`,
      },
      {
        subject: 'Re: Quick question, Marc',
        daysAgo: 2,
        hour: 11,
        body: `Bumping this — did my last note land?`,
      },
      {
        subject: 'Last one from me',
        daysAgo: 0,
        hour: 7,
        body: `I'll stop here. If the timing is wrong, just say so and I'll close the file.`,
      },
    ],
  },
  {
    name: 'Prize Notification',
    email: 'winner-notice@promo-rewards-intl.biz',
    messages: [
      {
        subject: 'Your reward is waiting',
        daysAgo: 5,
        hour: 2,
        body: `Congratulations. You have been selected. Claim within 48 hours.`,
      },
    ],
  },
  {
    name: 'SEO Partners',
    email: 'outreach@seopartners-global.com',
    messages: [
      {
        subject: 'I found 14 issues on ferrum.dev',
        daysAgo: 6,
        hour: 4,
        body: `I ran an audit on your website and found 14 issues affecting your ranking.

I can send the full report free of charge. Just reply "yes".`,
      },
    ],
  },
  {
    name: 'Conference Alerts',
    email: 'alerts@techsummit-invites.com',
    messages: [
      {
        subject: 'Speaker applications close Friday',
        daysAgo: 6,
        hour: 9,
        body: `Applications to speak at the summit close on Friday. Selected speakers receive a complimentary pass.`,
      },
    ],
  },
];

export function buildHeldMessages(): { sender: Sender; messages: Message[] }[] {
  return HELD_SEEDS.map((seed, si) => {
    const sender: Sender = {
      id: `s-held-${si}`,
      name: seed.name,
      email: seed.email,
      status: 'unknown',
    };
    const from: Address = { name: seed.name, email: seed.email };
    const messages: Message[] = seed.messages.map((m, mi) => ({
      id: `mh${si}-${mi}`,
      threadId: `th${si}-${mi}`,
      from,
      to: [USER],
      cc: [],
      subject: m.subject,
      body: m.body.trim(),
      date: at(m.daysAgo, m.hour, (si * 7 + mi * 13) % 60),
      attachments: [],
      isFromUser: false,
    }));
    return { sender, messages };
  });
}

// ---------------------------------------------------------------------------
// The known-senders list for O4 — 340-odd addresses, generated deterministically.
// ---------------------------------------------------------------------------

const FIRST_NAMES = [
  'Alex', 'Amara', 'Ana', 'Aziz', 'Bea', 'Caleb', 'Carmen', 'Chi', 'Clara', 'Dev',
  'Diana', 'Ed', 'Elif', 'Emil', 'Esme', 'Farah', 'Felix', 'Gabe', 'Greta', 'Hana',
  'Hugo', 'Ida', 'Ilya', 'Imani', 'Iris', 'Jonas', 'Julia', 'Kai', 'Karim', 'Kirsten',
  'Lars', 'Leah', 'Liv', 'Lucas', 'Maja', 'Malik', 'Mira', 'Nils', 'Nora', 'Omar',
  'Otto', 'Paulo', 'Pia', 'Quinn', 'Rafa', 'Rania', 'Rosa', 'Sam', 'Sofia', 'Stef',
  'Tara', 'Theo', 'Tomi', 'Ugo', 'Vera', 'Viktor', 'Wren', 'Yara', 'Zane', 'Zoe',
];

const LAST_NAMES = [
  'Abbot', 'Ahmadi', 'Baptiste', 'Berg', 'Cardoso', 'Chen', 'Dahl', 'Duval', 'Eriksen',
  'Falk', 'Girard', 'Grant', 'Haas', 'Ibarra', 'Jansen', 'Kaur', 'Keller', 'Larsen',
  'Lindholm', 'Marchetti', 'Mensah', 'Novak', 'Oduya', 'Pereira', 'Quist', 'Rahman',
  'Renard', 'Sandoval', 'Sorensen', 'Tavares', 'Ueda', 'Vogel', 'Weiss', 'Yilmaz',
];

const DOMAINS = [
  'lumenpartners.com', 'northbound.io', 'atlasgrid.dev', 'keelworks.de', 'doss-studio.com',
  'carvalho-arq.pt', 'meridianhealth.org', 'okonjo.legal', 'vancebooks.org', 'aoki.dev',
  'fischerlaw.de', 'brightsound.fm', 'halcyon-labs.com', 'quaystreet.co.uk', 'norda.no',
];

/** 340-odd senders Pigeon proposes on O4 (§5.3). */
export function buildKnownSenders(): Sender[] {
  const rand = mulberry32(20260726);
  const seen = new Set<string>();
  const out: Sender[] = [];

  for (const p of PEOPLE) {
    seen.add(p.email);
    out.push({
      id: `s-${out.length}`,
      name: p.name,
      email: p.email,
      status: 'unknown',
      knownReason: p.reason,
      replyCount: p.replyCount,
    });
  }

  while (out.length < 342) {
    const first = FIRST_NAMES[Math.floor(rand() * FIRST_NAMES.length)];
    const last = LAST_NAMES[Math.floor(rand() * LAST_NAMES.length)];
    const domain = DOMAINS[Math.floor(rand() * DOMAINS.length)];
    const email = `${first.toLowerCase()}.${last.toLowerCase()}@${domain}`;
    if (seen.has(email)) continue;
    seen.add(email);

    const hasReplies = rand() > 0.45;
    out.push({
      id: `s-${out.length}`,
      name: `${first} ${last}`,
      email,
      status: 'unknown',
      knownReason: hasReplies ? 'replies' : 'contact',
      replyCount: hasReplies ? 1 + Math.floor(rand() * 40) : undefined,
    });
  }

  return out;
}

export { USER as DEMO_USER, at as demoDate };
