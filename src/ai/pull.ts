import { httpFetch } from '../lib/http';

/**
 * Downloading a model, from inside Pigeon.
 *
 * A picker that recommends `qwen2.5:7b` to someone who has `llama3.2:3b` and
 * then leaves them to find a terminal is a picker that recommends nothing.
 * Ollama's `/api/pull` streams progress as newline-delimited JSON, which is
 * the same shape the chat stream uses — so this is the same reader, counting
 * bytes instead of accumulating text.
 *
 * Pigeon does not host, mirror or proxy anything here. The request goes to the
 * Ollama already running on this machine, and Ollama fetches from its own
 * registry exactly as `ollama pull` would.
 */

export interface PullProgress {
  /** Ollama's own status line, e.g. "pulling manifest", "verifying sha256". */
  status: string;
  /** 0–1 across the whole download, or null before any size is known. */
  fraction: number | null;
  /** Bytes pulled so far and expected, for the "2.1 of 4.7 GB" line. */
  completedBytes: number;
  totalBytes: number;
}

interface PullLine {
  status?: string;
  digest?: string;
  total?: number;
  completed?: number;
  error?: string;
}

function trimBase(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '');
}

/**
 * Pulls `name` into the endpoint at `baseUrl`, reporting progress.
 *
 * Resolves when Ollama says the model is there. Rejects with the message
 * Ollama gave — a mistyped tag comes back as a plain "file does not exist",
 * which is a far more useful thing to show than "download failed".
 */
export async function pullModel(
  baseUrl: string,
  name: string,
  onProgress: (progress: PullProgress) => void,
  signal?: AbortSignal,
): Promise<void> {
  const response = await httpFetch(`${trimBase(baseUrl)}/api/pull`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: name, stream: true }),
    signal,
  });

  if (!response.ok) {
    throw new Error(`Ollama refused the download (${response.status}).`);
  }

  /*
   * Ollama reports progress per layer, not per download: `total` and
   * `completed` reset every time it starts a new blob. Summing the layers it
   * has named so far is what produces a bar that only ever moves forwards —
   * tracking the latest line alone makes it snap back to zero several times.
   */
  const layers = new Map<string, { total: number; completed: number }>();
  let status = 'Starting';

  const report = () => {
    let total = 0;
    let completed = 0;
    for (const layer of layers.values()) {
      total += layer.total;
      completed += layer.completed;
    }
    onProgress({
      status,
      fraction: total > 0 ? Math.min(1, completed / total) : null,
      completedBytes: completed,
      totalBytes: total,
    });
  };

  const consume = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed) return;

    let parsed: PullLine;
    try {
      parsed = JSON.parse(trimmed) as PullLine;
    } catch {
      return;
    }

    if (parsed.error) throw new Error(parsed.error);
    if (parsed.status) status = parsed.status;
    if (parsed.digest && typeof parsed.total === 'number') {
      layers.set(parsed.digest, {
        total: parsed.total,
        completed: parsed.completed ?? 0,
      });
    }
    report();
  };

  // No readable body: Tauri's HTTP plugin buffers rather than streaming. The
  // download still happens; the bar simply arrives at the end.
  if (!response.body) {
    for (const line of (await response.text()).split('\n')) consume(line);
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    // The last piece is a half-received line and waits for the next read.
    buffer = lines.pop() ?? '';
    for (const line of lines) consume(line);
  }

  consume(buffer);
}

/** "2.1 of 4.7 GB", or just the total when nothing has arrived yet. */
export function progressLabel(progress: PullProgress): string {
  if (progress.totalBytes === 0) return progress.status;
  const gb = (bytes: number) => (bytes / 1e9).toFixed(1);
  return `${gb(progress.completedBytes)} of ${gb(progress.totalBytes)} GB`;
}
