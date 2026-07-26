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
export type ScenarioName = 'normal' | 'empty' | 'loading' | 'error' | 'revoked' | 'flaky';

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
];

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
    return failure ? Promise.reject(failure) : this.inner.getKnownSenders();
  }

  approveKnownSenders(ids: string[]): Promise<void> {
    return this.inner.approveKnownSenders(ids);
  }

  listThreads(place: 'inbox' | 'archive'): Promise<Thread[]> {
    if (this.scenario === 'loading') return never();
    if (this.scenario === 'empty') return Promise.resolve([]);
    const failure = this.failRead();
    return failure ? Promise.reject(failure) : this.inner.listThreads(place);
  }

  getThread(threadId: string): Promise<Thread> {
    if (this.scenario === 'loading') return never();
    const failure = this.failRead();
    return failure ? Promise.reject(failure) : this.inner.getThread(threadId);
  }

  markRead(threadId: string, read: boolean): Promise<void> {
    return this.inner.markRead(threadId, read);
  }

  setPlace(threadId: string, place: 'inbox' | 'archive'): Promise<void> {
    const failure = this.failWrite();
    return failure ? Promise.reject(failure) : this.inner.setPlace(threadId, place);
  }

  listHeld(): Promise<HeldSender[]> {
    if (this.scenario === 'loading') return never();
    if (this.scenario === 'empty') return Promise.resolve([]);
    const failure = this.failRead();
    return failure ? Promise.reject(failure) : this.inner.listHeld();
  }

  decideSender(senderId: string, decision: 'approved' | 'declined'): Promise<void> {
    const failure = this.failWrite();
    return failure ? Promise.reject(failure) : this.inner.decideSender(senderId, decision);
  }

  undecideSender(senderId: string): Promise<void> {
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

  unsend(messageId: string): Promise<void> {
    return this.inner.unsend(messageId);
  }

  search(query: string, includeHeld: boolean): Promise<SearchResults> {
    if (this.scenario === 'loading') return never();
    if (this.scenario === 'empty') return Promise.resolve({ inbox: [], archive: [], held: [] });
    const failure = this.failRead();
    return failure ? Promise.reject(failure) : this.inner.search(query, includeHeld);
  }
}

export function providerForScenario(scenario: ScenarioName): MailProvider {
  return scenario === 'normal' ? new MockMailProvider() : new ScenarioProvider(scenario);
}

export function isScenarioName(value: string | null): value is ScenarioName {
  return SCENARIOS.some((s) => s.name === value);
}
