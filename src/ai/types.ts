import type { Message, Thread } from '../types';
import type { ProviderConfig, ProviderId } from '../store/settings';

/** The four jobs the assistant does. One model per provider does all of them (D45). */
export interface AiClient {
  readonly provider: ProviderId;

  /** §7.9 — max 3 bullets, max 14 words each. */
  summarizeThread(thread: Thread, userEmail: string): Promise<string[]>;

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
  answer(
    question: string,
    sources: AnswerRequest[],
    /** Called with the answer so far, when the provider can stream. */
    onPartial?: (soFar: string) => void,
  ): Promise<AnswerResult>;

  /**
   * Recommends approve / decline / unsure for held senders. A recommendation
   * is a selection the user can accept, never an action — nothing in Pigeon
   * decides a sender on the model's say-so.
   */
  triageSenders(items: TriageRequest[]): Promise<TriageAnswer[]>;

  /**
   * Reads threads for what they oblige the reader to do.
   *
   * The one pass that looks across the mailbox rather than at one thread. Every
   * other surface answers a question about the thing on screen; this one
   * notices, which is the difference between a model in a mail client and a
   * mail client with an agent in it.
   *
   * A thread with nothing outstanding is simply absent from the result.
   */
  extractObligations(items: ObligationRequest[]): Promise<ObligationAnswer[]>;

  /**
   * One turn of the agent loop.
   *
   * The only method here that takes a conversation rather than a single
   * request — the agent's whole shape is "act, see the result, act again", and
   * a model cannot choose the second action without the first one's result in
   * front of it.
   */
  agentTurn(system: string, history: AgentMessage[]): Promise<string>;
}

export interface AgentMessage {
  /** `user` carries both the person's question and the tool results. */
  role: 'user' | 'assistant';
  content: string;
}

/** What a thread might be asking of the reader, or of somebody else. */
export type ObligationKind = 'needs-you' | 'you-promised' | 'waiting-on';

export interface ObligationRequest {
  threadId: string;
  /** Who the thread is with, from the reader's point of view. */
  counterparty: string;
  subject: string;
  /** The conversation, newest last, with each message marked as sent or not. */
  transcript: string;
  /** Whether the reader wrote the newest message. Decides `waiting-on`. */
  readerSpokeLast: boolean;
  /** Whole days since the newest message. */
  ageDays: number;
}

export interface ObligationAnswer {
  threadId: string;
  kind: ObligationKind;
  /** The obligation itself, as a short imperative or statement. */
  what: string;
  /** Who it is with. Copied from the request rather than invented. */
  who: string;
  /**
   * When it is due, exactly as the mail put it — "Friday", "the 3rd", "before
   * the renewal". Absent when the thread names no time at all, which is most
   * of them, and inventing one would be the worst thing this pass could do.
   */
  due?: string;
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
  /**
   * The same request, delivering text as it arrives.
   *
   * Optional. An adapter without it is called through `complete` and the
   * caller simply never sees a partial — which is why `onText` is the only
   * difference in the signature, and why nothing above this layer branches on
   * whether streaming happened.
   *
   * A local model is the reason this exists. Three sentences out of a 3B model
   * on a laptop is several seconds of a motionless "Reading the results…",
   * which reads as a hang; the same wait with words appearing in it reads as
   * work. Nothing about the final answer changes.
   */
  stream?(
    config: ProviderConfig,
    system: string,
    user: string,
    maxTokens: number,
    onText: (soFar: string) => void,
  ): Promise<{ text: string; usd: number; ms: number }>;
}
