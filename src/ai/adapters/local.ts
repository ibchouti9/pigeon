import type { Adapter, TestResult } from '../types';
import { httpFetch } from '../../lib/http';
import { AiError } from '../types';
import type { ProviderConfig } from '../../store/settings';

/**
 * D47 — a local provider has no key. Pigeon asks for a base URL and lists the
 * models the endpoint reports. Nothing leaves the machine.
 *
 * Speaks Ollama's native API, which LM Studio also serves.
 */

function trimBase(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '');
}

function unreachable(baseUrl: string): AiError {
  return new AiError(
    `Nothing is answering at ${baseUrl}. Start your local model, then test again.`,
    'unreachable',
  );
}

interface OllamaTags {
  models?: { name?: string; model?: string }[];
}

interface OllamaChat {
  message?: { content?: string };
}

async function listModels(baseUrl: string): Promise<string[]> {
  const response = await httpFetch(`${trimBase(baseUrl)}/api/tags`);
  if (!response.ok) throw unreachable(baseUrl);
  const body = (await response.json().catch(() => null)) as OllamaTags | null;
  return (body?.models ?? [])
    .map((m) => m.name ?? m.model ?? '')
    .filter(Boolean);
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
    response = await httpFetch(`${trimBase(config.baseUrl)}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: config.model,
        stream: false,
        options: { num_predict: maxTokens },
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      }),
    });
  } catch {
    throw unreachable(config.baseUrl);
  }

  if (!response.ok) throw unreachable(config.baseUrl);
  const body = (await response.json().catch(() => null)) as OllamaChat | null;

  // A local model costs the user nothing, so spend stays at zero (D46).
  return {
    text: body?.message?.content ?? '',
    usd: 0,
    ms: Math.round(performance.now() - started),
  };
}

export const localAdapter: Adapter = {
  async test(config): Promise<TestResult> {
    const started = performance.now();
    try {
      const models = await listModels(config.baseUrl);
      return { ok: true, ms: Math.round(performance.now() - started), models };
    } catch {
      return {
        ok: false,
        status: 'unreachable',
        message: `Nothing is answering at ${config.baseUrl}. Start your local model, then test again.`,
      };
    }
  },

  complete: post,
};
