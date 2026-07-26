import type { Adapter, ModelPricing, TestResult } from '../types';
import { httpFetch } from '../../lib/http';
import { AiError } from '../types';
import type { ProviderConfig } from '../../store/settings';

const BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

const PRICING: Record<string, ModelPricing> = {
  'gemini-3-pro': { input: 1.25, output: 10 },
  'gemini-3-flash': { input: 0.3, output: 2.5 },
};

interface GoogleResponse {
  candidates?: { content?: { parts?: { text?: string }[] } }[];
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
  error?: { status?: string; message?: string };
}

function classify(status: number, body: GoogleResponse | null): AiError {
  const message = body?.error?.message ?? '';

  if (status === 400 && /API key not valid|API_KEY_INVALID/i.test(message)) {
    return new AiError(
      'Google rejected this key. Check it in your provider dashboard and paste it again.',
      'rejected',
    );
  }
  if (status === 401 || status === 403) {
    if (/quota|billing|credit/i.test(message)) {
      return new AiError(
        'Google returned no credit on this account. Top up, or switch provider.',
        'no-credit',
      );
    }
    return new AiError(
      'Google rejected this key. Check it in your provider dashboard and paste it again.',
      'rejected',
    );
  }
  if (status === 429) {
    return new AiError(
      'Google is rate-limiting Pigeon. Summaries and drafts will come back on their own.',
      'rate-limited',
    );
  }
  return new AiError('Couldn\'t reach Google. Check your connection and test again.', 'offline');
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
    // The key rides in a header rather than the query string: a key in a URL
    // ends up in history and logs (§C-27 security rules).
    response = await httpFetch(`${BASE}/${encodeURIComponent(config.model)}:generateContent`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-goog-api-key': config.apiKey,
      },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text: user }] }],
        generationConfig: { maxOutputTokens: maxTokens },
      }),
    });
  } catch {
    throw new AiError('Couldn\'t reach Google. Check your connection and test again.', 'offline');
  }

  const body = (await response.json().catch(() => null)) as GoogleResponse | null;
  if (!response.ok) throw classify(response.status, body);

  const text = (body?.candidates?.[0]?.content?.parts ?? [])
    .map((p) => p.text ?? '')
    .join('');

  const pricing = PRICING[config.model] ?? { input: 1.25, output: 10 };
  const usd =
    ((body?.usageMetadata?.promptTokenCount ?? 0) / 1_000_000) * pricing.input +
    ((body?.usageMetadata?.candidatesTokenCount ?? 0) / 1_000_000) * pricing.output;

  return { text, usd, ms: Math.round(performance.now() - started) };
}

export const googleAdapter: Adapter = {
  async test(config): Promise<TestResult> {
    if (!navigator.onLine) {
      return {
        ok: false,
        status: 'offline',
        message: 'Couldn\'t reach Google. Check your connection and test again.',
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

export const GOOGLE_MODELS = Object.keys(PRICING);
