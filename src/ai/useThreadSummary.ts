import { useCallback, useEffect, useRef, useState } from 'react';
import type { Thread } from '../types';
import { AiError } from './types';
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
  /**
   * §7.6's rate-limit line when that is why it failed, and null otherwise —
   * which leaves §3.4 2b's "Summary unavailable." as the default.
   */
  failedText: string | null;
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
  /** §7.6's rate-limit line, when that is why it failed. */
  const [failedText, setFailedText] = useState<string | null>(null);
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
      } catch (error) {
        if (requestedFor.current !== target.id) return;
        /*
         * §7.6 gives a rate-limited provider its own line — "Summaries and
         * drafts will come back on their own" — because it means something
         * different from "unavailable": it will fix itself, and retrying now
         * won't help. Every consumer discarded the error, so the one case with
         * good news attached read the same as a hard failure.
         */
        setFailedText(error instanceof AiError && error.status === 'rate-limited' ? error.message : null);
        setState('failed');
      }
    },
    [client, account?.email],
  );

  // Keyed on the thread *id*, not the object.
  //
  // Marking a thread read replaces it in the store with `{ ...t, unread: false }`
  // — a new object with the same id — 1.2 seconds after it opens. Depending on
  // the object identity meant that every eligible unread thread threw away its
  // finished summary and regenerated it a second after the reader appeared.
  const threadRef = useRef(thread);
  threadRef.current = thread;

  useEffect(() => {
    setState('idle');
    setBullets([]);
    requestedFor.current = null;

    const target = threadRef.current;
    if (!target || !client || !autoSummarize) return;
    if (!shouldAutoSummarize(target)) return;
    void run(target);
  }, [threadId, client, autoSummarize, run]);

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
    failedText,
    offersButton: Boolean(thread && client && state === 'idle'),
    summarize,
    hide,
    hidden: threadId ? hiddenIds.has(threadId) : false,
  };
}
