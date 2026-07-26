import type { Adapter } from '../types';

/**
 * Canned assistant output, so every AI surface in the product can be seen,
 * reviewed and tested without a key. It is offered as an explicit provider
 * choice labelled as a demo — it never stands in for a provider the user
 * thinks is real.
 */

const DELAY_MS = 700;

function delay<T>(value: T, ms = DELAY_MS): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}

/**
 * The tone buttons echoed the draft straight back, so §3.4 4a's crossfade and
 * checked state were unobservable without a real key — on the provider whose
 * whole job is making every AI surface reviewable without one. These follow
 * §7.9's own tone rules, and each keeps the `[confirm:]` placeholder so D26
 * stays exercised through a retone.
 */
function retone(system: string, draft: string): string {
  const paragraphs = draft.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const keep = (p: string) => p.includes('[confirm:');

  if (/Target 60% of the/.test(system)) {
    // "Remove sentences; never compress into jargon."
    const trimmed = paragraphs.filter((p, i) => keep(p) || i === 0 || i === paragraphs.length - 1);
    return trimmed
      .map((p) => (keep(p) ? p : p.split(/(?<=\.)\s+/)[0]))
      .join('\n\n');
  }

  if (/Add a greeting and a closing courtesy/.test(system)) {
    const body = paragraphs.filter((p) => !/^Hi\b/.test(p) && !/^Marc$/.test(p));
    return ['Hi there,', ...body.map((p) => p.replace(/^Please /, 'Would you mind ')), 'Thanks very much,', 'Marc'].join(
      '\n\n',
    );
  }

  // Firmer — "remove hedges and apologies, state the request as a direct ask".
  return paragraphs
    .map((p) =>
      keep(p)
        ? p.replace(/I'd rather settle it on a call than over mail — does/, 'Let\u2019s settle it on a call:')
        : p.replace(/\bI think\b|\bjust\b|\bmaybe\b|\bperhaps\b/gi, '').replace(/\s{2,}/g, ' ').trim(),
    )
    .join('\n\n');
}

/** Enough shape-matching to exercise the parsers in prompts.ts. */
function respond(system: string, user: string): string {
  if (system.includes('Summarize a mail thread')) {
    const subject = user.match(/^Subject: (.*)$/m)?.[1] ?? 'the thread';
    return [
      `- Legal returned ${subject.toLowerCase()} with three changes.`,
      '- Liability cap moved from $1M to $500K.',
      '- Dana Whitlock needs an answer before Friday.',
    ].join('\n');
  }

  if (system.includes('why a held message might matter')) {
    // Reads a couple of signals out of the message the way a model would, so
    // the demo's reads actually match the mail rather than all saying the same
    // thing.
    if (/suggested I reach out|introduc|referred/i.test(user)) {
      return 'A warm intro from someone you email often.';
    }
    if (/unsubscribe|roundup|newsletter|issue \d+/i.test(user)) {
      return 'A newsletter you have never opened or replied to.';
    }
    if (/\brole\b|\bcontract\b|day rate|remote-first/i.test(user)) {
      return 'A recruiter pitching a role at a company with no reply history.';
    }
    if (/demo|invited|book|discovery call|audit/i.test(user)) {
      return 'Cold sales mail from a list — no reply history.';
    }
    return /never written/.test(user)
      ? 'Bulk mail from an address with no reply history.'
      : 'A message from an address you have written to before.';
  }

  if (system.includes('everyone waiting in the Screener')) {
    const total = Number(user.match(/^(\d+) senders are waiting/m)?.[1] ?? 0);
    if (total === 0) return 'Nothing is waiting.';
    const junk = Math.max(0, total - 3);
    return `${total} senders held: ${junk} junk, 2 recruiters, 1 looks like a client inquiry.`;
  }

  if (system.includes('Rewrite a draft reply')) {
    return retone(system, user.trim());
  }

  // Draft reply — deliberately carries a placeholder so D26 can be exercised.
  // A bare address is not a name. Greeting someone "Hi ines@carvalho-arq.pt,"
  // is exactly the kind of output §7.9 rules out, demo or not.
  const recipient = user.match(/^Reply to: (.*)$/m)?.[1]?.split(/[,<]/)[0]?.trim() ?? '';
  const name = recipient.includes('@') || !recipient ? 'there' : recipient.split(' ')[0];
  return `Hi ${name},

Thanks for this. I've read through it and I'm happy with the direction.

On the open point, I'd rather settle it on a call than over mail — does [confirm: a time on Thursday] work for you?

Marc`;
}

export const demoAdapter: Adapter = {
  async test() {
    return delay({ ok: true as const, ms: DELAY_MS });
  },

  async complete(_config, system, user) {
    return delay({ text: respond(system, user), usd: 0, ms: DELAY_MS });
  },
};
