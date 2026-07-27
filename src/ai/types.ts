import type { HeldSender, Message, Thread } from '../types';
import type { ProviderConfig, ProviderId } from '../store/settings';

/** The four jobs the assistant does. One model per provider does all of them (D45). */
export interface AiClient {
  readonly provider: ProviderId;

  /** §7.9 — max 3 bullets, max 14 words each. */
  summarizeThread(thread: Thread, userEmail: string): Promise<string[]>;

  /** §7.9 — exactly one sentence, max 18 words. */
  readSender(held: HeldSender, context: SenderContext): Promise<string>;

  /** §7.9 — no new facts; anything unverifiable becomes `[confirm: …]` (D26). */
  draftReply(input: DraftInput): Promise<string>;

  /** D27 — three named transformations, each regenerating from the current draft. */
  retone(draft: string, tone: Tone): Promise<string>;

  /**
   * Sorts threads into lanes. Only ever handed the ones the deterministic pass
   * was unsure of, and answers about as many as it can — a thread the model
   * skipped or named a nonexistent lane for is simply absent from the result,
   * and keeps the rules' verdict.
   */
  sortThreads(items: SortRequest[]): Promise<SortAnswer[]>;

  /**
   * Answers a question from the threads a search found, and from nothing else.
   * `sources` is already ranked; the answer cites them by position.
   */
  answer(question: string, sources: AnswerRequest[]): Promise<AnswerResult>;

  /**
   * Recommends approve / decline / unsure for held senders. A recommendation
   * is a selection the user can accept, never an action — nothing in Pigeon
   * decides a sender on the model's say-so.
   */
  triageSenders(items: TriageRequest[]): Promise<TriageAnswer[]>;
}

export interface TriageRequest {
  senderId: string;
  from: string;
  subject: string;
  body: string;
}

export interface TriageAnswer {
  senderId: string;
  suggestion: 'approve' | 'decline' | 'unsure';
  why: string;
}

export interface AnswerRequest {
  threadId: string;
  from: string;
  subject: string;
  date: string;
  body: string;
}

export interface AnswerResult {
  text: string;
  /** Thread ids the answer cited, in the order it cited them. */
  cited: string[];
  /** The model said the mail does not contain an answer. */
  refused: boolean;
}

export interface SortRequest {
  threadId: string;
  from: string;
  subject: string;
  preview: string;
}

export interface SortAnswer {
  threadId: string;
  lane: string;
  /** At most seven words, or empty when the model gave none. */
  why: string;
}

export type Tone = 'shorter' | 'friendlier' | 'firmer';

export interface SenderContext {
  /** How many messages the user has sent this address. */
  replyCount: number;
  /** Names the user emails often, for "a warm intro from X" reads. */
  frequentContacts: string[];
}

export interface DraftInput {
  /** The thread being replied to, newest last. Empty for a new message. */
  messages: Message[];
  subject: string;
  recipients: string[];
  userName: string;
  /** Samples of the user's own sent mail, when "match my writing style" is on. */
  styleSamples?: string[];
}

/** C-27's status table. Each value maps to exactly one message in §7.6. */
export type TestStatus = 'rejected' | 'no-credit' | 'unreachable' | 'offline';

export type TestResult =
  | { ok: true; ms: number; models?: string[] }
  | { ok: false; status: TestStatus; message: string };

/** Thrown by every adapter so the UI can render the right §7.6 line. */
export class AiError extends Error {
  readonly status: TestStatus | 'rate-limited' | 'unknown';

  constructor(message: string, status: AiError['status'] = 'unknown') {
    super(message);
    this.name = 'AiError';
    this.status = status;
  }
}

/** What a provider charges, so Settings → Assistant can report spend (D46). */
export interface ModelPricing {
  /** USD per million input tokens. */
  input: number;
  /** USD per million output tokens. */
  output: number;
}

export interface Adapter {
  /** Round-trips one trivial request to prove the key works. */
  test(config: ProviderConfig): Promise<TestResult>;
  /** Returns the completion text plus what it cost. */
  complete(
    config: ProviderConfig,
    system: string,
    user: string,
    maxTokens: number,
  ): Promise<{ text: string; usd: number; ms: number }>;
}
