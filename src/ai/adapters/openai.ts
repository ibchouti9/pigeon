import type { Adapter, ModelPricing, TestResult } from '../types';
import { AiError } from '../types';
import type { ProviderConfig } from '../../store/settings';

const ENDPOINT = 'https://api.openai.com/v1/chat/completions';

const PRICING: Record<string, ModelPricing> = {
  'gpt-5.1': { input: 1.25, output: 10 },
  'gpt-5.1-mini': { input: 0.25, output: 2 },
};

interface OpenAiResponse {
  choices?: { message?: { content?: string } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  error?: { type?: string; code?: string; message?: string };
}

function classify(status: number, body: OpenAiResponse | null): AiError {
  const code = body?.error?.code ?? '';
  const message = body?.error?.message ?? '';

  if (status === 401 || code === 'invalid_api_key') {
    return new AiError(
      'OpenAI rejected this key. Check it in your provider dashboard and paste it again.',
      'rejected',
    );
  }
  if (code === 'insufficient_quota' || /quota|billing|credit/i.test(message)) {
    return new AiError(
      'OpenAI returned no credit on this account. Top up, or switch provider.',
      'no-credit',
    );
  }
  if (status === 403) {
    return new AiError(
      'OpenAI rejected this key. Check it in your provider dashboard and paste it again.',
      'rejected',
    );
  }
  if (status === 429) {
    return new AiError(
      'OpenAI is rate-limiting Pigeon. Summaries and drafts will come back on their own.',
      'rate-limited',
    );
  }
  return new AiError('Couldn\'t reach OpenAI. Check your connection and test again.', 'offline');
}

async function post(
  config: ProviderConfig,
  system: string,
  user: string,
  maxTokens: number,
): Promise<{ text: string; usd: number; ms: number }> {
  const started = performance.now();
  let response: Response;

  try {
    response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        max_completion_tokens: maxTokens,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      }),
    });
  } catch {
    throw new AiError('Couldn\'t reach OpenAI. Check your connection and test again.', 'offline');
  }

  const body = (await response.json().catch(() => null)) as OpenAiResponse | null;
  if (!response.ok) throw classify(response.status, body);

  const text = body?.choices?.[0]?.message?.content ?? '';
  const pricing = PRICING[config.model] ?? { input: 1.25, output: 10 };
  const usd =
    ((body?.usage?.prompt_tokens ?? 0) / 1_000_000) * pricing.input +
    ((body?.usage?.completion_tokens ?? 0) / 1_000_000) * pricing.output;

  return { text, usd, ms: Math.round(performance.now() - started) };
}

export const openaiAdapter: Adapter = {
  async test(config): Promise<TestResult> {
    if (!navigator.onLine) {
      return {
        ok: false,
        status: 'offline',
        message: 'Couldn\'t reach OpenAI. Check your connection and test again.',
      };
    }
    try {
      const { ms } = await post(config, 'Reply with the single word OK.', 'Say OK.', 16);
      return { ok: true, ms };
    } catch (error) {
      const e = error as AiError;
      const status = e.status === 'rate-limited' || e.status === 'unknown' ? 'offline' : e.status;
      return { ok: false, status, message: e.message };
    }
  },

  complete: post,
};

export const OPENAI_MODELS = Object.keys(PRICING);
