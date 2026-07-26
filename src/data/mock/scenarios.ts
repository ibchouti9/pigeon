import type { Address, HeldSender, Message, Sender, SyncProgress, Thread } from '../../types';
import { MailError, type MailProvider, type SearchResults } from '../provider';
import { MockMailProvider } from './mockProvider';

/**
 * §8.5 item 1 — every screen must render its empty, loading and error states,
 * reachable in a dev harness. Rather than mounting components with fixture
 * props, these wrap the demo provider so the *real* screens reach those states
 * through their real code paths. A state you can only see in a fixture is a
 * state you haven't actually tested.
 */
export type ScenarioName =
  | 'normal'
  | 'empty'
  | 'loading'
  | 'error'
  | 'revoked'
  | 'flaky'
  | 'crowded';

export const SCENARIOS: { name: ScenarioName; label: string; description: string }[] = [
  { name: 'normal', label: 'Normal', description: 'The seeded demo account.' },
  { name: 'empty', label: 'Empty', description: 'No mail anywhere, nothing held.' },
  { name: 'loading', label: 'Loading', description: 'Every request hangs, so skeletons stay up.' },
  { name: 'error', label: 'Error', description: 'Gmail is unreachable.' },
  { name: 'revoked', label: 'Token revoked', description: 'Google withdrew permission.' },
  {
    name: 'flaky',
    label: 'Flaky writes',
    description: 'Reads work; every second decision fails, so bulk review reports a partial failure (§3.3 3b).',
  },
  {
    name: 'crowded',
    label: 'Crowded account',
    description:
      'A decade of mail: 800 threads, 120 held senders, and every thread 40 messages long. O4 already shows 342 known senders on the seeded account.',
  },
];

/** The scale a crowded account reaches. Sized to the states never yet driven. */
const CROWD = { threads: 800, held: 120, messages: 40 };

/**
 * Amplifies the demo seed rather than writing a second one: each copy keeps the
 * original's shape and takes a distinct id and date, so grouping, sorting and
 * §2.3's filter all behave as they do on real data.
 */
function amplify<T>(seed: T[], count: number, clone: (item: T, n: number) => T): T[] {
  if (seed.length === 0) return [];
  return Array.from({ length: count }, (_, i) => clone(seed[i % seed.length], i));
}

/** A held sender's newest waiting message — what §5.4 sorts the stack by. */
function newest(entry: HeldSender): string {
  return entry.messages.reduce((latest, m) => (m.date > latest ? m.date : latest), '');
}

/** Same day-of every copy would collapse §5.5's date groups into one header. */
function daysBefore(iso: string, days: number): string {
  return new Date(Date.parse(iso) - days * 86_400_000).toISOString();
}

function never<T>(): Promise<T> {
  return new Promise<T>(() => {});
}

const UNREACHABLE = () =>
  new MailError(
    "Pigeon can't reach Gmail. Your mail is safe. This is a connection problem between Pigeon and Google.",
    'unreachable',
  );

const REVOKED = () =>
  new MailError(
    "Pigeon lost access to your mail. Google revoked Pigeon's permission. Connect your account again to keep using Pigeon.",
    'revoked',
  );

/**
 * Wraps the demo provider, overriding only what a scenario needs to change.
 * Everything else falls through, so a scenario stays a few lines rather than a
 * second implementation that drifts.
 */
class ScenarioProvider implements MailProvider {
  readonly kind = 'mock' as const;

  private readonly inner = new MockMailProvider();
  private readonly scenario: ScenarioName;

  constructor(scenario: ScenarioName) {
    this.scenario = scenario;
  }

  private failRead(): MailError | null {
    if (this.scenario === 'error') return UNREACHABLE();
    if (this.scenario === 'revoked') return REVOKED();
    return null;
  }

  /**
   * `flaky` fails every second write. Failing all of them would only ever
   * produce "0 of 9 succeeded", which is the total-failure path — §3.3 3b's
   * partial failure, where some rows leave and some come back with a retry
   * affordance, needs a mix.
   */
  private writeAttempt = 0;

  private failWrite(): MailError | null {
    if (this.scenario === 'flaky') {
      return this.writeAttempt++ % 2 === 1 ? UNREACHABLE() : null;
    }
    return this.failRead();
  }

  getAccount() {
    return this.inner.getAccount();
  }

  sync(onProgress: (p: SyncProgress) => void): Promise<void> {
    if (this.scenario === 'loading') return never();
    if (this.scenario === 'error') {
      onProgress({ total: 11_908, done: 4_312, step: 'history', error: 'Gmail returned an error.' });
      return Promise.reject(UNREACHABLE());
    }
    return this.inner.sync(onProgress);
  }

  getKnownSenders(): Promise<Sender[]> {
    if (this.scenario === 'loading') return never();
    if (this.scenario === 'empty') return Promise.resolve([]);
    const failure = this.failRead();
    // Not amplified: the demo seed already holds 342 known senders, which is
    // the scale O4 has to survive.
    return failure ? Promise.reject(failure) : this.inner.getKnownSenders();
  }

  approveKnownSenders(ids: string[]): Promise<void> {
    return this.inner.approveKnownSenders(ids);
  }

  async listThreads(
    place: 'inbox' | 'archive',
    onPage?: (threads: Thread[]) => void,
  ): Promise<Thread[]> {
    if (this.scenario === 'loading') return never();
    if (this.scenario === 'empty') return [];
    const failure = this.failRead();
    if (failure) throw failure;

    const threads = await this.inner.listThreads(place, onPage);
    if (this.scenario !== 'crowded') return threads;

    const crowd = this.crowdThreads.get(place) ?? this.buildCrowd(place, threads);
    onPage?.(crowd);
    return crowd;
  }

  private readonly crowdThreads = new Map<string, Thread[]>();

  /**
   * Every crowded thread is a long one. The reader at forty messages is a state
   * that has never been driven, and one long thread in eight hundred is not
   * something a walkthrough would happen to open.
   */
  private buildCrowd(place: 'inbox' | 'archive', seeds: Thread[]): Thread[] {
    const crowd = amplify(seeds, CROWD.threads, (thread, n) => {
      const last = daysBefore(thread.lastMessageAt, n);
      return {
        ...thread,
        id: `crowd-${place}-${n}`,
        lastMessageAt: last,
        // Dated back from the thread's own last message, so the reader reads in
        // order and the header agrees with the row that opened it.
        messages: amplify(thread.messages, CROWD.messages, (m, i) => ({
          ...m,
          id: `crowd-${place}-${n}-${i}`,
          date: daysBefore(last, CROWD.messages - 1 - i),
        })),
      };
    }).sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt));

    this.crowdThreads.set(place, crowd);
    return crowd;
  }

  async getThread(threadId: string): Promise<Thread> {
    if (this.scenario === 'loading') return never();
    const failure = this.failRead();
    if (failure) throw failure;

    for (const threads of this.crowdThreads.values()) {
      const found = threads.find((t) => t.id === threadId);
      if (found) return found;
    }

    return this.inner.getThread(threadId);
  }

  markRead(threadId: string, read: boolean): Promise<void> {
    return this.inner.markRead(threadId, read);
  }

  setPlace(threadId: string, place: 'inbox' | 'archive'): Promise<void> {
    const failure = this.failWrite();
    return failure ? Promise.reject(failure) : this.inner.setPlace(threadId, place);
  }

  async listHeld(): Promise<HeldSender[]> {
    if (this.scenario === 'loading') return never();
    if (this.scenario === 'empty') return [];
    const failure = this.failRead();
    if (failure) throw failure;

    const held = await this.inner.listHeld();
    if (this.scenario !== 'crowded') return held;

    if (!this.crowdHeld) {
      this.crowdHeld = amplify(held, CROWD.held, (entry, n) => ({
        ...entry,
        sender: {
          ...entry.sender,
          id: `crowd-held-${n}`,
          email: `${n}.${entry.sender.email}`,
        },
        messages: entry.messages.map((m, i) => ({
          ...m,
          id: `crowd-held-${n}-${i}`,
          date: daysBefore(m.date, n),
        })),
      })).sort((a, b) => newest(b).localeCompare(newest(a)));
    }

    return this.crowdHeld.filter((h) => !this.crowdDecided.has(h.sender.id));
  }

  /*
   * The crowded Screener keeps its own list. The demo account has never heard
   * of these senders, so its `decideSender` would throw not-found on every card
   * — and a Screener where no decision can be made is exactly the screen this
   * scenario exists to drive at 120 senders.
   */
  private crowdHeld: HeldSender[] | null = null;
  private readonly crowdDecided = new Set<string>();

  private crowdDecide(senderId: string): boolean {
    if (this.scenario !== 'crowded' || !senderId.startsWith('crowd-held-')) return false;
    this.crowdDecided.add(senderId);
    return true;
  }

  decideSender(senderId: string, decision: 'approved' | 'declined'): Promise<void> {
    const failure = this.failWrite();
    if (failure) return Promise.reject(failure);
    if (this.crowdDecide(senderId)) return Promise.resolve();
    return this.inner.decideSender(senderId, decision);
  }

  undecideSender(senderId: string): Promise<void> {
    // §3.2 3c — the card has to come back, or undo is a lie.
    if (this.crowdDecided.delete(senderId)) return Promise.resolve();
    return this.inner.undecideSender(senderId);
  }

  listSenders(status: 'approved' | 'declined'): Promise<Sender[]> {
    if (this.scenario === 'loading') return never();
    if (this.scenario === 'empty') return Promise.resolve([]);
    const failure = this.failRead();
    return failure ? Promise.reject(failure) : this.inner.listSenders(status);
  }

  listContacts(): Promise<Address[]> {
    return this.scenario === 'empty' ? Promise.resolve([]) : this.inner.listContacts();
  }

  send(draft: Parameters<MailProvider['send']>[0]): Promise<Message> {
    if (this.scenario === 'flaky' || this.scenario === 'error' || this.scenario === 'revoked') {
      return Promise.reject(
        new MailError(
          "Gmail didn't accept this message. Check the recipient addresses and send again.",
          'send-rejected',
        ),
      );
    }
    return this.inner.send(draft);
  }

  async downloadAttachment(messageId: string, attachmentId: string): Promise<string> {
    const failure = this.failRead();
    if (failure) throw failure;
    return this.inner.downloadAttachment(messageId, attachmentId);
  }

  unsend(messageId: string): Promise<void> {
    return this.inner.unsend(messageId);
  }

  async search(query: string, includeHeld: boolean): Promise<SearchResults> {
    if (this.scenario === 'loading') return never();
    if (this.scenario === 'empty') return { inbox: [], archive: [], held: [] };
    const failure = this.failRead();
    if (failure) throw failure;
    if (this.scenario !== 'crowded') return this.inner.search(query, includeHeld);

    // Searching the seed would report five results against eight hundred
    // threads, so §5.11 would never be driven at the scale that matters.
    const q = query.trim().toLowerCase();
    if (q.length < 2) return { inbox: [], archive: [], held: [] };

    const matches = (t: Thread) =>
      t.subject.toLowerCase().includes(q) ||
      t.messages.some(
        (m) =>
          m.body.toLowerCase().includes(q) ||
          m.from.name.toLowerCase().includes(q) ||
          m.from.email.toLowerCase().includes(q),
      );

    const [inbox, archive] = await Promise.all([
      this.listThreads('inbox'),
      this.listThreads('archive'),
    ]);

    return {
      inbox: inbox.filter(matches),
      archive: archive.filter(matches),
      held: includeHeld
        ? (await this.listHeld()).filter(
            (h) =>
              h.sender.name.toLowerCase().includes(q) ||
              h.sender.email.toLowerCase().includes(q) ||
              h.messages.some(
                (m) => m.subject.toLowerCase().includes(q) || m.body.toLowerCase().includes(q),
              ),
          )
        : [],
    };
  }
}

export function providerForScenario(scenario: ScenarioName): MailProvider {
  return scenario === 'normal' ? new MockMailProvider() : new ScenarioProvider(scenario);
}

export function isScenarioName(value: string | null): value is ScenarioName {
  return SCENARIOS.some((s) => s.name === value);
}
