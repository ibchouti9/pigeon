import type { AiClient, Adapter, DraftInput, SenderContext, TestResult, Tone } from './types';
import { AiError } from './types';
import type { HeldSender, Thread } from '../types';
import { type ProviderConfig, type ProviderId, useSettings } from '../store/settings';
import {
  DIGEST_SYSTEM,
  READ_SYSTEM,
  SUMMARY_SYSTEM,
  cleanCompletion,
  digestUser,
  draftSystem,
  draftUser,
  parseBullets,
  parseSentence,
  readUser,
  summaryUser,
  toneSystem,
} from './prompts';
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

export const PROVIDER_ENDPOINTS: Record<ProviderId, string> = {
  anthropic: 'api.anthropic.com',
  openai: 'api.openai.com',
  google: 'generativelanguage.googleapis.com',
  local: '',
  demo: 'none — canned replies',
  none: '',
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
  read: 128,
  digest: 192,
  draft: 1024,
};

function makeClient(config: ProviderConfig): AiClient {
  const adapter = ADAPTERS[config.provider as Exclude<ProviderId, 'none'>];

  async function run(system: string, user: string, maxTokens: number): Promise<string> {
    const { text, usd, ms } = await adapter.complete(config, system, user, maxTokens);
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

    async readSender(held: HeldSender, context: SenderContext) {
      const text = await run(READ_SYSTEM, readUser(held, context), MAX_TOKENS.read);
      const sentence = parseSentence(text, 18);
      if (!sentence) throw new AiError('Read unavailable.');
      return sentence;
    },

    async digest(held: HeldSender[]) {
      const text = await run(DIGEST_SYSTEM, digestUser(held), MAX_TOKENS.digest);
      const sentence = parseSentence(text, 40);
      if (!sentence) throw new AiError('Digest unavailable.');
      return sentence;
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
    readSender: fail,
    digest: fail,
    draftReply: fail,
    retone: fail,
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
