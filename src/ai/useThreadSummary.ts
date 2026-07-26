import { useCallback, useEffect, useRef, useState } from 'react';
import type { Thread } from '../types';
import { useAssistant, useBehaviour } from './useAssistant';
import { useMail } from '../store/mail';

export type SummaryState = 'idle' | 'loading' | 'ready' | 'failed';

/**
 * D5 — summaries are automatic for threads with 4 or more messages or over
 * 1,200 words. Below that, a "Summarize thread" button is shown and nothing is
 * generated until it is pressed.
 */
export function shouldAutoSummarize(thread: Thread): boolean {
  if (thread.messages.length >= 4) return true;
  const words = thread.messages.reduce(
    (n, m) => n + m.body.split(/\s+/).filter(Boolean).length,
    0,
  );
  return words > 1200;
}

export interface ThreadSummary {
  state: SummaryState;
  bullets: string[];
  /** True when the thread is below the threshold and nothing has been asked for. */
  offersButton: boolean;
  summarize: () => void;
  hide: () => void;
  hidden: boolean;
}

export function useThreadSummary(thread: Thread | null): ThreadSummary {
  const { client } = useAssistant();
  const { autoSummarize } = useBehaviour();
  const account = useMail((s) => s.account);

  const [state, setState] = useState<SummaryState>('idle');
  const [bullets, setBullets] = useState<string[]>([]);
  // §5.6 — hiding is remembered per thread for the session only.
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(() => new Set());
  const requestedFor = useRef<string | null>(null);

  const threadId = thread?.id ?? null;

  const run = useCallback(
    async (target: Thread) => {
      if (!client) return;
      requestedFor.current = target.id;
      setState('loading');
      try {
        const result = await client.summarizeThread(target, account?.email ?? '');
        // A slower earlier request must not overwrite a newer thread's summary.
        if (requestedFor.current !== target.id) return;
        setBullets(result);
        setState('ready');
      } catch {
        if (requestedFor.current !== target.id) return;
        setState('failed');
      }
    },
    [client, account?.email],
  );

  useEffect(() => {
    setState('idle');
    setBullets([]);
    requestedFor.current = null;
    if (!thread || !client || !autoSummarize) return;
    if (!shouldAutoSummarize(thread)) return;
    void run(thread);
  }, [thread, client, autoSummarize, run]);

  const summarize = useCallback(() => {
    if (thread) void run(thread);
  }, [thread, run]);

  const hide = useCallback(() => {
    if (!threadId) return;
    setHiddenIds((prev) => new Set(prev).add(threadId));
  }, [threadId]);

  return {
    state,
    bullets,
    offersButton: Boolean(thread && client && state === 'idle'),
    summarize,
    hide,
    hidden: threadId ? hiddenIds.has(threadId) : false,
  };
}
