import type {
  AiClient,
  Adapter,
  AnswerRequest,
  AnswerResult,
  DraftInput,
  SortAnswer,
  SortRequest,
  TriageAnswer,
  TriageRequest,
  TestResult,
  Tone,
} from './types';
import { AiError } from './types';
import type { Thread } from '../types';
import { type ProviderConfig, type ProviderId, useSettings } from '../store/settings';
import {
  ANSWER_SYSTEM,
  answerUser,
  citedSources,
  SUMMARY_SYSTEM,
  cleanCompletion,
  draftSystem,
  draftUser,
  parseBullets,
  isRefusal,
  parseLaneLines,
  tidyAnswer,
  SORT_SYSTEM,
  sortUser,
  TRIAGE_SYSTEM,
  triageUser,
  summaryUser,
  toneSystem,
} from './prompts';
import { LANES } from '../data/lanes';
import { anthropicAdapter, ANTHROPIC_MODELS } from './adapters/anthropic';
import { openaiAdapter, OPENAI_MODELS } from './adapters/openai';
import { googleAdapter, GOOGLE_MODELS } from './adapters/google';
import { localAdapter } from './adapters/local';
import { demoAdapter } from './adapters/demo';

const ADAPTERS: Record<Exclude<ProviderId, 'none'>, Adapter> = {
  anthropic: anthropicAdapter,
  openai: openaiAdapter,
  google: googleAdapter,
  local: localAdapter,
  demo: demoAdapter,
};

/** D45 — a curated list per provider. Never a free-text model field. */
export const CURATED_MODELS: Record<ProviderId, string[]> = {
  anthropic: ANTHROPIC_MODELS,
  openai: OPENAI_MODELS,
  google: GOOGLE_MODELS,
  local: [],
  demo: ['demo'],
  none: [],
};

/**
 * C-27's curated endpoints, for the screens that name where a key is sent.
 * Remote providers only: Local uses the base URL the user supplies, and the
 * rest reach nothing. The adapters hold their own full request URLs — a
 * hostname can't carry a path — so this is what the UI shows, not what it
 * calls.
 */
export const PROVIDER_ENDPOINTS: Partial<Record<ProviderId, string>> = {
  anthropic: 'api.anthropic.com',
  openai: 'api.openai.com',
  google: 'generativelanguage.googleapis.com',
};

/** Used by O2 and Settings → Assistant. Never throws. */
export async function testConnection(config: ProviderConfig): Promise<TestResult> {
  if (config.provider === 'none') {
    return { ok: false, status: 'unreachable', message: 'No provider is selected.' };
  }
  return ADAPTERS[config.provider].test(config);
}

/** Output ceilings sized to the §7.9 limits, not to the model's capacity. */
const MAX_TOKENS = {
  summary: 256,
  draft: 1024,
  /** One short line per thread, and a batch is at most `SORT_BATCH` of them. */
  sort: 512,
  /** Three sentences. The ceiling is the rule, not a suggestion to fill it. */
  answer: 320,
  /** One short line per sender, `TRIAGE_BATCH` of them. */
  triage: 512,
};

/** The three answers `TRIAGE_SYSTEM` is allowed to give. */
const SUGGESTIONS = ['approve', 'decline', 'unsure'] as const;

/**
 * Held senders per triage request. Smaller than the sorting batch: each item
 * carries a body excerpt rather than a preview line, and this is the prompt
 * whose mistakes are the most expensive.
 */
export const TRIAGE_BATCH = 8;

/**
 * How many threads an answer is allowed to read.
 *
 * Every one of these is up to 1,200 characters of body in a single prompt, and
 * a laptop model's recall across a long context is the first thing to go. Six
 * well-ranked threads beat twenty badly-ranked ones, and the search that
 * produced them already sorted by how well they matched.
 */
export const ANSWER_SOURCES = 6;

/**
 * How many threads go in one sorting request.
 *
 * Small enough that a 3B model on a laptop keeps the line format all the way
 * to the end — accuracy falls off a cliff somewhere past a dozen rows, and the
 * tail of a long batch is where a model starts answering in prose. Small
 * enough, too, that a batch that fails loses very little.
 */
export const SORT_BATCH = 10;

/**
 * A reason worth showing a person, or nothing.
 *
 * Asked for evidence, a small model will sometimes hand back the sender's
 * address or the subject line — the two things the user is already looking at.
 * "from: marketing@kavelle.com" appeared verbatim under a Kavelle email in the
 * reader, which reads as a broken feature rather than a considered one. The
 * prompt asks it not to; this is what happens when it does anyway.
 *
 * An empty reason is a fine outcome: the lane still stands, and the UI has an
 * honest line for a verdict that came with no argument.
 */
function usableReason(why: string, item: { from: string; subject: string }): string {
  const trimmed = why.trim();
  if (trimmed.length < 4) return '';

  const lower = trimmed.toLowerCase();
  if (lower.includes('@') || lower.startsWith('from')) return '';

  /*
   * Word overlap, not substring. A substring test caught "Intro to the Atlas
   * team" and missed "Introduction to Atlas team" — the same echo, reworded
   * just enough, printed under a subject line two rows above it. Anything that
   * is mostly the subject's own words is the subject.
   */
  const words = (v: string) => v.toLowerCase().match(/\p{L}{3,}/gu) ?? [];
  const subject = words(item.subject);
  const reason = words(trimmed);
  // Prefix, not equality: "Introduction to Atlas team" is "Intro to the Atlas
  // team" with one word lengthened, and word-for-word matching scored it 2 of
  // 3 — just under the bar, and straight onto the screen.
  const shares = (w: string) =>
    subject.some((s) => (w.length >= s.length ? w.startsWith(s) : s.startsWith(w)));
  if (subject.length > 1 && reason.length > 0) {
    if (reason.filter(shares).length / reason.length >= 0.7) return '';
  }

  return trimmed;
}

function makeClient(config: ProviderConfig): AiClient {
  const adapter = ADAPTERS[config.provider as Exclude<ProviderId, 'none'>];

  async function run(system: string, user: string, maxTokens: number): Promise<string> {
    const { text, usd, ms } = await adapter.complete(config, system, user, maxTokens);
    useSettings.getState().recordCall(usd, ms);
    return text;
  }

  /**
   * `run`, delivering text as it arrives when the adapter can. An adapter with
   * no `stream` is called normally and `onText` simply never fires before the
   * end — so no caller has to know which kind it got.
   */
  async function runStreaming(
    system: string,
    user: string,
    maxTokens: number,
    onText?: (soFar: string) => void,
  ): Promise<string> {
    if (!onText || !adapter.stream) return run(system, user, maxTokens);
    const { text, usd, ms } = await adapter.stream(config, system, user, maxTokens, onText);
    useSettings.getState().recordCall(usd, ms);
    return text;
  }

  return {
    provider: config.provider,

    async summarizeThread(thread: Thread, userEmail: string) {
      const text = await run(SUMMARY_SYSTEM, summaryUser(thread, userEmail), MAX_TOKENS.summary);
      const bullets = parseBullets(text);
      if (bullets.length === 0) throw new AiError('Summary unavailable.');
      return bullets;
    },

    async draftReply(input: DraftInput) {
      const text = await run(
        draftSystem(input.styleSamples),
        draftUser(input),
        MAX_TOKENS.draft,
      );
      const body = cleanCompletion(text);
      if (!body) throw new AiError('Pigeon couldn\'t write a draft. Write your reply, or try again.');
      return body;
    },

    async sortThreads(items: SortRequest[]): Promise<SortAnswer[]> {
      if (items.length === 0) return [];
      const text = await run(
        SORT_SYSTEM,
        sortUser(items.map((item, i) => ({ n: i + 1, ...item }))),
        MAX_TOKENS.sort,
      );
      return parseLaneLines(text, LANES)
        .filter((line) => line.n >= 1 && line.n <= items.length)
        .map((line) => {
          const item = items[line.n - 1];
          return {
            threadId: item.threadId,
            lane: line.lane,
            why: usableReason(line.why, item),
          };
        });
    },

    async answer(
      question: string,
      sources: AnswerRequest[],
      onPartial?: (soFar: string) => void,
    ): Promise<AnswerResult> {
      if (sources.length === 0) {
        return { text: 'Not in this mail.', cited: [], refused: true };
      }
      const capped = sources.slice(0, ANSWER_SOURCES);
      const raw = cleanCompletion(
        await runStreaming(
          ANSWER_SYSTEM,
          answerUser(question, capped.map((s, i) => ({ n: i + 1, ...s }))),
          MAX_TOKENS.answer,
          /*
           * The partial is tidied on the way past, so what the user watches
           * appear is the same shape as what settles: a model that ends its
           * answer and starts a footnote paragraph does not get to flash the
           * footnote on screen before it is removed.
           */
          onPartial && ((soFar) => onPartial(tidyAnswer(soFar))),
        ),
      );
      const text = tidyAnswer(raw);
      if (!text) throw new AiError('Pigeon couldn\'t answer that. Try again, or read the results.');
      /*
       * Citations come from the *whole* completion, not the tidied text: a
       * model that lists its sources in a footnote paragraph has still cited
       * them, and that paragraph is exactly what `tidyAnswer` removes.
       */
      return {
        text,
        cited: citedSources(raw, capped.length).map((n) => capped[n - 1].threadId),
        refused: isRefusal(text),
      };
    },

    async triageSenders(items: TriageRequest[]): Promise<TriageAnswer[]> {
      if (items.length === 0) return [];
      const text = await run(
        TRIAGE_SYSTEM,
        triageUser(items.map((item, i) => ({ n: i + 1, ...item }))),
        MAX_TOKENS.triage,
      );
      return parseLaneLines(text, SUGGESTIONS)
        .filter((line) => line.n >= 1 && line.n <= items.length)
        .map((line) => {
          const item = items[line.n - 1];
          return {
            senderId: item.senderId,
            suggestion: line.lane as TriageAnswer['suggestion'],
            // Same echo filter as the lane pass, and for the same reason: the
            // first live run answered every row with that row's subject line.
            why: usableReason(line.why, item),
          };
        });
    },

    async retone(draft: string, tone: Tone) {
      const text = await run(toneSystem(tone), draft, MAX_TOKENS.draft);
      const body = cleanCompletion(text);
      if (!body) throw new AiError('Pigeon couldn\'t write a draft. Write your reply, or try again.');
      return body;
    },
  };
}

/**
 * Returns null when no provider is connected. Every caller must handle null by
 * rendering the C-28 degraded form — never an error, never a nag (D44).
 */
/**
 * Dev-only. §8.5 item 1 wants every state reachable in the harness, and the AI
 * failure states — §3.4 2b's "Summary unavailable.", §5.7's omitted card read,
 * §5.7's digest fallback — were the last ones that weren't: `/dev/states` swaps
 * the *mail* provider, and no provider anyone can run without a key fails.
 *
 * Folded away in production by the `import.meta.env.DEV` guard at its only
 * caller below.
 */
const AI_FAILURE_KEY = 'pigeon.dev.aiFailure';

export function setAiFailureForDev(fail: boolean): void {
  // sessionStorage, not a module variable: the harness is most useful when the
  // state survives the reload you do to look at a screen, and it dies with the
  // tab rather than following anyone into a later session.
  if (fail) sessionStorage.setItem(AI_FAILURE_KEY, '1');
  else sessionStorage.removeItem(AI_FAILURE_KEY);
}

export function isAiFailingForDev(): boolean {
  return import.meta.env.DEV && sessionStorage.getItem(AI_FAILURE_KEY) === '1';
}

function failingClient(provider: ProviderId): AiClient {
  const fail = async (): Promise<never> => {
    await new Promise((r) => setTimeout(r, 300));
    throw new AiError("Pigeon couldn't write a draft. Write your reply, or try again.");
  };
  return {
    provider,
    summarizeThread: fail,
    draftReply: fail,
    retone: fail,
    // Sorting has a deterministic answer already; the failure harness only
    // needs it to produce nothing, not to throw into a background pass.
    sortThreads: async () => [],
    answer: fail,
    triageSenders: async () => [],
  };
}

export function getAiClient(config: ProviderConfig): AiClient | null {
  if (config.provider === 'none') return null;
  if (config.provider === 'local' && !(config.baseUrl && config.model)) return null;
  if (config.provider !== 'local' && config.provider !== 'demo' && !config.apiKey) return null;
  if (!config.model) return null;
  if (isAiFailingForDev()) return failingClient(config.provider);
  return makeClient(config);
}
