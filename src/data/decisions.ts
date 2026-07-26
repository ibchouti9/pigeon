import type { Thread } from '../types';

/**
 * §2.3's sender decisions, as one shared machine.
 *
 * This grew up inside the Gmail provider as three booleans on a record —
 * `keptExisting`, `reversedDecline`, a carried `silenced` list — and a pair of
 * mirrored guards over them. Four of the six defects found in review passes
 * lived in the interactions of those flags, because each flag remembered one
 * fact about the *latest* transition and §2.3's rules are about the sender's
 * whole history. The third decision was always the one that lied.
 *
 * So the model is now the history itself: the periods during which the sender
 * stood declined. Every §2.3 rule reduces to one sentence over it —
 *
 *   **a thread is hidden iff it started while its sender stood declined** —
 *
 * with two refinements, both straight from the spec:
 *
 * - A Screener decline reaches back over everything (D7: "never appears in
 *   Pigeon"), so its interval starts at the beginning of time, not at the
 *   decision. A decline that reverses a real approval starts at the decision,
 *   which is exactly "leaves their existing inbox threads in place".
 * - What `silence()` archived stays archived whatever later decisions say
 *   ("reversing a decline only affects mail received after the reversal"),
 *   until the 8-second undo of that specific decline puts it back.
 *
 * The flags model also got one §2.3 sentence wrong that this one gets right:
 * approve → decline → approve again surfaced the mail that had arrived while
 * the sender stood declined, because the second approval saw `keptExisting`
 * and concluded there was nothing to hold back. The interval it now falls
 * inside doesn't care what the flags around it were doing.
 *
 * Decisions live in `localStorage`, keyed by account. Pigeon has no server to
 * sync them through (D41), and a mail label cannot express "this address may
 * reach me" for mail that has not arrived yet.
 */

export interface DeclinedInterval {
  /**
   * ISO date, or null for "since the beginning" — a decline with no prior
   * approval hides the sender's history too (D7).
   */
  from: string | null;
  /** ISO date the decline was reversed, or null while it still stands. */
  to: string | null;
}

interface SenderRecord {
  status: 'approved' | 'declined';
  /** When the latest decision was made. */
  at: string;
  name?: string;
  declined: DeclinedInterval[];
  /** Thread ids a decline archived out of the inbox. Always hidden. */
  silenced?: string[];
  /**
   * The record as it stood before the latest decision — one level, because
   * undo is only ever offered on the latest decision, for eight seconds (D9).
   */
  previous?: SenderSnapshot | null;
}

type SenderSnapshot = Omit<SenderRecord, 'previous'>;

export interface SenderSummary {
  email: string;
  name?: string;
  at: string;
}

function storageKey(accountEmail: string): string {
  return `pigeon.decisions.${accountEmail.toLowerCase()}`;
}

function cutoffKey(accountEmail: string): string {
  return `pigeon.screenFrom.${accountEmail.toLowerCase()}`;
}

/**
 * When a thread started. A thread is one unit, so every §2.3 rule is about the
 * conversation rather than its latest message — asking about `lastMessageAt`
 * let a single reply drag an entire history across a cutoff.
 */
function startedAt(thread: Thread): string {
  // The engine reports this per thread, from the metadata of every message in
  // it. A listing row (`preview: true`) holds one synthetic message dated to
  // the newest, so reducing the messages there would date a decade-old
  // conversation to this morning — and every §2.3 interval would be measured
  // against the wrong end of it.
  if (thread.firstMessageAt) return thread.firstMessageAt;
  return thread.messages.reduce(
    (earliest, m) => (m.date < earliest ? m.date : earliest),
    thread.lastMessageAt,
  );
}

/** An unreadable or absent cutoff means "screen everything", as it did before. */
function readCutoff(key: string): string | null {
  try {
    const stored = localStorage.getItem(key);
    return stored && !Number.isNaN(Date.parse(stored)) ? stored : null;
  } catch {
    return null;
  }
}

function snapshot(record: SenderRecord): SenderSnapshot {
  const { previous: _previous, ...rest } = record;
  return { ...rest, declined: [...record.declined], silenced: record.silenced?.slice() };
}

export class SenderDecisions {
  private readonly key: string;
  private readonly cutoff: string;
  private records: Record<string, SenderRecord>;
  private screenFromAt: string | null;

  private constructor(
    key: string,
    cutoff: string,
    records: Record<string, SenderRecord>,
    screenFrom: string | null,
  ) {
    this.key = key;
    this.cutoff = cutoff;
    this.records = records;
    this.screenFromAt = screenFrom;
  }

  static load(accountEmail: string): SenderDecisions {
    const key = storageKey(accountEmail);
    const cutoff = cutoffKey(accountEmail);
    const screenFrom = readCutoff(cutoff);
    try {
      const parsed = JSON.parse(localStorage.getItem(key) ?? '{}') as Record<
        string,
        SenderRecord
      >;
      for (const [email, record] of Object.entries(parsed)) {
        // A record whose shape this build doesn't recognise is dropped rather
        // than guessed at; the sender returns to the Screener, which is the
        // safe direction to be wrong in.
        if (!Array.isArray(record?.declined) || typeof record.at !== 'string') {
          delete parsed[email];
        }
      }
      return new SenderDecisions(key, cutoff, parsed, screenFrom);
    } catch {
      return new SenderDecisions(key, cutoff, {}, screenFrom);
    }
  }

  private write(): void {
    try {
      localStorage.setItem(this.key, JSON.stringify(this.records));
    } catch {
      // Decisions still apply for this page load.
    }
  }

  /* ---------------------------------------------------------------------- */
  /* The screening cutoff                                                    */
  /* ---------------------------------------------------------------------- */

  /**
   * Marks where screening starts, once, when the account is first connected.
   *
   * Later calls are ignored on purpose: the line is a fact about when the user
   * set Pigeon up, and a line that moved would take senders out of the Screener
   * without anyone deciding anything — §2.3 knows undecided, approved and
   * declined, and "aged out" is none of them. That is also why this is a fixed
   * date rather than a rolling window over the last N months.
   */
  beginScreening(at: string): void {
    if (this.screenFromAt) return;
    this.screenFromAt = at;
    try {
      localStorage.setItem(this.cutoff, at);
    } catch {
      // The line still holds for this page load.
    }
  }

  screenFrom(): string | null {
    return this.screenFromAt;
  }

  /**
   * Whether the Screener has any business with this conversation.
   *
   * Mail that was already in the mailbox when Pigeon arrived stays exactly
   * where Gmail put it: nothing is held, nothing is hidden, and the inbox on day
   * one looks like the inbox the user already had. A 40,000-thread account would
   * otherwise open onto a stack of several hundred strangers to judge before
   * reaching any mail — and the promise is that Pigeon screens what arrives, not
   * that it audits what arrived.
   *
   * Judged on when the conversation *started*, like every other §2.3 rule, so a
   * single new reply cannot drag a decade-old thread in front of the user.
   */
  screens(thread: Thread): boolean {
    if (!this.screenFromAt) return true;
    return startedAt(thread) >= this.screenFromAt;
  }

  has(email: string): boolean {
    return this.records[email.toLowerCase()] !== undefined;
  }

  status(email: string): 'approved' | 'declined' | undefined {
    return this.records[email.toLowerCase()]?.status;
  }

  /** The one rule. See the module comment. */
  hidden(thread: Thread, email: string): boolean {
    const record = this.records[email.toLowerCase()];
    if (!record) return false;

    if (record.silenced?.includes(thread.id)) return true;

    const started = startedAt(thread);
    return record.declined.some(
      (iv) =>
        (iv.from === null || started >= iv.from) && (iv.to === null || started < iv.to),
    );
  }

  /**
   * Records a decision and reports what the transport should do about it:
   * `screenerDecline` is true when this decline is the D7 kind, whose held
   * mail should be archived (`silence()`d) out of the inbox.
   */
  decide(
    email: string,
    decision: 'approved' | 'declined',
    name?: string,
  ): { screenerDecline: boolean } {
    const key = email.toLowerCase();
    const before = this.records[key];
    const at = new Date().toISOString();
    const declined = before ? [...before.declined] : [];

    if (decision === 'declined') {
      if (!declined.some((iv) => iv.to === null)) {
        // Reversing a real approval hides only what starts now ("leaves their
        // existing inbox threads in place"); a sender never approved loses
        // their history too (D7).
        declined.push({ from: before?.status === 'approved' ? at : null, to: null });
      }
    } else {
      for (let i = 0; i < declined.length; i += 1) {
        if (declined[i].to === null) declined[i] = { ...declined[i], to: at };
      }
    }

    this.records[key] = {
      status: decision,
      at,
      name: name ?? before?.name,
      declined,
      silenced: before?.silenced,
      previous: before ? snapshot(before) : null,
    };
    this.write();

    return {
      screenerDecline: decision === 'declined' && before?.status !== 'approved',
    };
  }

  /**
   * O4's bulk approval. The same transition as `decide`, applied to many —
   * an overwrite here once dropped every `silenced` list it crossed.
   */
  bulkApprove(emails: string[]): void {
    for (const email of emails) this.decide(email, 'approved');
  }

  /** Threads the transport archived for this sender's standing decline. */
  addSilenced(email: string, threadIds: string[]): void {
    const record = this.records[email.toLowerCase()];
    if (!record || threadIds.length === 0) return;
    record.silenced = [...(record.silenced ?? []), ...threadIds];
    this.write();
  }

  /**
   * Reverses the latest decision, restoring the record it replaced, and
   * returns the thread ids that decision silenced — the caller puts them back
   * (§3.2 3c: "the card returns to the top of the stack", and its mail with
   * it).
   *
   * Reverses the *latest* decision by design. If another decision landed
   * inside the first one's 8-second undo window, the toast's undo now reverses
   * that later decision instead of silently doing nothing, which is the lesser
   * surprise.
   */
  undecide(email: string): string[] {
    const key = email.toLowerCase();
    const record = this.records[key];
    if (!record) return [];

    const kept = record.previous?.silenced ?? [];
    const mine = (record.silenced ?? []).filter((id) => !kept.includes(id));

    if (record.previous) this.records[key] = { ...record.previous };
    else delete this.records[key];
    this.write();

    return mine;
  }

  list(status: 'approved' | 'declined'): SenderSummary[] {
    return Object.entries(this.records)
      .filter(([, record]) => record.status === status)
      .map(([email, record]) => ({ email, name: record.name, at: record.at }));
  }
}
