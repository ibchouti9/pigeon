import { canProbeLoopback } from '../lib/desktop';
import { httpFetch } from '../lib/http';

/**
 * Finding the model that is already running on this machine.
 *
 * The people most likely to want Pigeon are the ones who already have Ollama
 * or LM Studio open, and asking them to type `http://localhost:11434` into a
 * text field is asking them to configure something Pigeon could simply look
 * for. Three ports, two seconds, no key, nothing sent anywhere.
 *
 * This is a probe, not a connection: it reports what answered, and the user
 * still chooses. Pigeon never silently points itself at a server.
 */

export interface LocalEndpoint {
  baseUrl: string;
  /** What the runtime calls itself, for the one line the UI shows. */
  runtime: string;
  models: string[];
}

/** Default ports, in the order they are most likely to be the one running. */
const CANDIDATES: { baseUrl: string; runtime: string }[] = [
  { baseUrl: 'http://localhost:11434', runtime: 'Ollama' },
  { baseUrl: 'http://localhost:1234', runtime: 'LM Studio' },
  { baseUrl: 'http://localhost:8080', runtime: 'llama.cpp' },
];

/** Long enough for a loaded runtime, short enough not to stall the screen. */
const PROBE_MS = 1500;

interface TagsBody {
  models?: { name?: string; model?: string }[];
}

interface OpenAiModelsBody {
  data?: { id?: string }[];
}

async function withTimeout(url: string): Promise<Response | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_MS);
  try {
    return await httpFetch(url, { signal: controller.signal });
  } catch {
    // A closed port, a CORS refusal and a timeout are the same answer here:
    // nothing usable is at this address.
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Model names from whichever API the runtime speaks. Ollama's `/api/tags` is
 * tried first because `localAdapter` speaks Ollama natively; LM Studio serves
 * both and llama.cpp serves only the OpenAI-shaped one.
 */
async function modelsAt(baseUrl: string): Promise<string[] | null> {
  const tags = await withTimeout(`${baseUrl}/api/tags`);
  if (tags?.ok) {
    const body = (await tags.json().catch(() => null)) as TagsBody | null;
    const names = (body?.models ?? []).map((m) => m.name ?? m.model ?? '').filter(Boolean);
    if (names.length > 0) return names;
  }

  const openai = await withTimeout(`${baseUrl}/v1/models`);
  if (openai?.ok) {
    const body = (await openai.json().catch(() => null)) as OpenAiModelsBody | null;
    const names = (body?.data ?? []).map((m) => m.id ?? '').filter(Boolean);
    if (names.length > 0) return names;
  }

  return null;
}

/**
 * Embedding-only models can't answer a chat request, and offering one as the
 * assistant's model produces an empty completion and a "try again" the user
 * can never satisfy. Naming is the only signal any of these APIs gives.
 */
export function isChatModel(name: string): boolean {
  return !/embed|bge-|gte-|e5-|minilm|rerank/i.test(name);
}

/** The first endpoint that answers, or null. Never throws. */
export async function detectLocalEndpoint(): Promise<LocalEndpoint | null> {
  /*
   * Nothing is listening on a phone's own loopback, and finding that out costs
   * three ports at 1.5 seconds each on the one screen where the user is
   * waiting to get past. iOS suspends every app that is not in front, so the
   * runtime this probe looks for cannot be running beside Pigeon by design.
   *
   * The model a phone *can* reach is on another machine, and no probe will
   * find it — there is no guessing a LAN address. The Local row stays offered
   * there; it just arrives with an empty field instead of a filled one.
   */
  if (!canProbeLoopback()) return null;

  for (const candidate of CANDIDATES) {
    const models = await modelsAt(candidate.baseUrl);
    if (!models) continue;
    const chat = models.filter(isChatModel);
    // A runtime serving nothing but embeddings is running, and is still no use
    // as an assistant. Say nothing rather than offer a model that cannot reply.
    if (chat.length === 0) continue;
    return { ...candidate, models: chat };
  }
  return null;
}

/**
 * Which of the found models to offer first.
 *
 * Small and instruction-tuned beats large and clever for what Pigeon asks of a
 * model: three bullets, one sentence, a lane name. A 3B model answers those in
 * under a second on a laptop, and a 70B one makes the summary feel broken.
 */
export function preferredModel(models: string[]): string {
  const scored = models.map((name) => {
    const size = /(\d+(?:\.\d+)?)\s*b\b/i.exec(name);
    const billions = size ? Number(size[1]) : 8;
    // Distance from 4B: big enough to follow the format, small enough to be
    // instant. Reasoning models are pushed down — Pigeon's prompts want an
    // answer, not a chain of thought it then has to strip.
    const thinks = /qwq|reason|thinking|-r1|deepseek-r1/i.test(name) ? 40 : 0;
    return { name, score: Math.abs(billions - 4) + thinks };
  });
  scored.sort((a, b) => a.score - b.score || a.name.localeCompare(b.name));
  return scored[0]?.name ?? '';
}
