import type { Adapter, TestResult } from '../types';
import { httpFetch } from '../../lib/http';
import { AiError } from '../types';
import type { ProviderConfig } from '../../store/settings';
import { isChatModel } from '../detectLocal';

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
    .filter(Boolean)
    /*
     * An embedding model is in `/api/tags` and cannot answer a chat request.
     * Offering one in the model picker — which the connection test populates —
     * hands the user a choice whose only outcome is an empty completion and a
     * "try again" they can never satisfy.
     */
    .filter(isChatModel);
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

/**
 * Ollama's streaming shape: newline-delimited JSON, one object per token-ish
 * chunk, each carrying the delta rather than the total.
 *
 * The reader has to buffer across chunk boundaries — a network read can and
 * does split a line in half, and `JSON.parse` on half an object throws. That
 * is the whole subtlety here, and getting it wrong produces a stream that
 * works on a fast localhost and drops text on a slow one.
 */
async function streamPost(
  config: ProviderConfig,
  system: string,
  user: string,
  maxTokens: number,
  onText: (soFar: string) => void,
): Promise<{ text: string; usd: number; ms: number }> {
  const started = performance.now();
  let response: Response;

  try {
    response = await httpFetch(`${trimBase(config.baseUrl)}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: config.model,
        stream: true,
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

  /*
   * No readable body: Tauri's HTTP plugin buffers the whole response rather
   * than handing back a stream. Falling back to one `onText` with the lot is
   * better than failing, and better than a second round trip.
   */
  if (!response.body) {
    const text = collect(await response.text());
    onText(text);
    return { text, usd: 0, ms: Math.round(performance.now() - started) };
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let text = '';

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // Everything up to the last newline is complete; the remainder is a
    // half-received line and stays in the buffer until the next read.
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      const chunk = parseChunk(line);
      if (chunk === null) continue;
      text += chunk;
      onText(text);
    }
  }

  const tail = parseChunk(buffer);
  if (tail) {
    text += tail;
    onText(text);
  }

  return { text, usd: 0, ms: Math.round(performance.now() - started) };
}

function parseChunk(line: string): string | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  try {
    return (JSON.parse(trimmed) as OllamaChat).message?.content ?? null;
  } catch {
    return null;
  }
}

/** Reassembles a whole NDJSON body that arrived in one piece. */
function collect(body: string): string {
  return body
    .split('\n')
    .map(parseChunk)
    .filter((c): c is string => c !== null)
    .join('');
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
  stream: streamPost,
};
