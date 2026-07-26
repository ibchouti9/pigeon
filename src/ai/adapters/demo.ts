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
    return user.trim();
  }

  // Draft reply — deliberately carries a placeholder so D26 can be exercised.
  const name = user.match(/^Reply to: (.*)$/m)?.[1]?.split(/[,<]/)[0]?.trim() ?? 'there';
  return `Hi ${name.split(' ')[0]},

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
