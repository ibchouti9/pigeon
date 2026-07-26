import type { Adapter, ModelPricing, TestResult } from '../types';
import { AiError } from '../types';
import type { ProviderConfig } from '../../store/settings';

const ENDPOINT = 'https://api.anthropic.com/v1/messages';
const API_VERSION = '2023-06-01';

/**
 * USD per million tokens. Reported in Settings → Assistant; Pigeon never caps
 * or bills (D46).
 */
const PRICING: Record<string, ModelPricing> = {
  'claude-sonnet-5': { input: 3, output: 15 },
  'claude-haiku-4-5': { input: 1, output: 5 },
};

interface AnthropicResponse {
  content?: { type: string; text?: string }[];
  usage?: { input_tokens?: number; output_tokens?: number };
  stop_reason?: string;
  error?: { type?: string; message?: string };
}

function headers(apiKey: string): HeadersInit {
  return {
    'content-type': 'application/json',
    'x-api-key': apiKey,
    'anthropic-version': API_VERSION,
    // Required for calls made straight from a browser. Pigeon has no server to
    // proxy through — that is the whole point of D41 — so the key travels from
    // the user's own browser to Anthropic and nowhere else.
    'anthropic-dangerous-direct-browser-access': 'true',
  };
}

/** Maps an HTTP status and error body onto one line from §7.6. */
function classify(status: number, body: AnthropicResponse | null): AiError {
  const type = body?.error?.type ?? '';
  const message = body?.error?.message ?? '';
  const billing = /credit|balance|quota|billing/i.test(message) || type === 'billing_error';

  if (status === 401 || type === 'authentication_error') {
    return new AiError(
      'Anthropic rejected this key. Check it in your provider dashboard and paste it again.',
      'rejected',
    );
  }
  if (billing || (status === 403 && !type)) {
    return new AiError(
      'Anthropic returned no credit on this account. Top up, or switch provider.',
      'no-credit',
    );
  }
  if (status === 403 || type === 'permission_error') {
    return new AiError(
      'Anthropic rejected this key. Check it in your provider dashboard and paste it again.',
      'rejected',
    );
  }
  if (status === 429 || type === 'rate_limit_error') {
    return new AiError(
      'Anthropic is rate-limiting Pigeon. Summaries and drafts will come back on their own.',
      'rate-limited',
    );
  }
  return new AiError('Couldn\'t reach Anthropic. Check your connection and test again.', 'offline');
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
      headers: headers(config.apiKey),
      body: JSON.stringify({
        model: config.model,
        max_tokens: maxTokens,
        system,
        messages: [{ role: 'user', content: user }],
        // Short, structured outputs on a latency-sensitive surface: the reader
        // is watching a skeleton. Low effort with thinking off is the fastest
        // configuration that still holds the §7.9 rules.
        thinking: { type: 'disabled' },
        output_config: { effort: 'low' },
      }),
    });
  } catch {
    throw new AiError(
      'Couldn\'t reach Anthropic. Check your connection and test again.',
      'offline',
    );
  }

  const body = (await response.json().catch(() => null)) as AnthropicResponse | null;
  if (!response.ok) throw classify(response.status, body);

  const text = (body?.content ?? [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text ?? '')
    .join('');

  const pricing = PRICING[config.model] ?? { input: 3, output: 15 };
  const usd =
    ((body?.usage?.input_tokens ?? 0) / 1_000_000) * pricing.input +
    ((body?.usage?.output_tokens ?? 0) / 1_000_000) * pricing.output;

  return { text, usd, ms: Math.round(performance.now() - started) };
}

export const anthropicAdapter: Adapter = {
  async test(config): Promise<TestResult> {
    if (!navigator.onLine) {
      return {
        ok: false,
        status: 'offline',
        message: 'Couldn\'t reach Anthropic. Check your connection and test again.',
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

export const ANTHROPIC_MODELS = Object.keys(PRICING);
