import { useCallback, useEffect, useRef, useState } from 'react';
import { useAssistant } from '../../ai/useAssistant';
import type { Digest, HeldSender } from '../../types';
import { buildDigestGroups } from './digest';

export interface ScreenerDigestResult {
  digest?: Digest;
  state: 'loading' | 'ready' | 'failed';
  hasProvider: boolean;
  retry: () => void;
}

/**
 * Fetches the "This week" digest sentence once per Screener visit via the
 * shared assistant client (`src/ai`) — not on every decision, since
 * re-summarizing after each approve/decline would be wasteful and noisy.
 * Grouping data for the chips is derived locally from each held sender's
 * `category`, which never needs the model.
 */
export function useScreenerDigest(held: HeldSender[], listReady: boolean): ScreenerDigestResult {
  const { client, connected } = useAssistant();
  const [sentence, setSentence] = useState<string | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading');

  const heldRef = useRef(held);
  heldRef.current = held;
  const fetchedFor = useRef<string | null>(null);

  const run = useCallback(() => {
    if (!client) return;
    const current = heldRef.current;
    if (current.length === 0) return;
    setState('loading');
    client
      .digest(current)
      .then((text) => {
        setSentence(text);
        setState('ready');
      })
      .catch(() => setState('failed'));
  }, [client]);

  useEffect(() => {
    if (!listReady || !connected || !client) return;
    if (fetchedFor.current === client.provider) return;
    fetchedFor.current = client.provider;
    run();
  }, [listReady, connected, client, run]);

  const groups = buildDigestGroups(held);
  const digest: Digest | undefined =
    held.length > 0 ? { sentence: sentence ?? '', groups } : undefined;

  return { digest, state, hasProvider: connected, retry: run };
}
