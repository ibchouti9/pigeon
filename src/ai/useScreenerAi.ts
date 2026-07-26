import { useCallback, useEffect, useRef, useState } from 'react';
import type { Digest, DigestCategory, HeldSender } from '../types';
import { useAssistant, useBehaviour } from './useAssistant';
import { useMail } from '../store/mail';

export type AiState = 'idle' | 'loading' | 'ready' | 'failed';

/** The fixed category vocabulary from §7.9. */
const CATEGORIES: DigestCategory[] = [
  'junk',
  'newsletters',
  'recruiters',
  'sales',
  'support',
  'client inquiry',
  'personal',
  'unclear',
  'other',
];

/**
 * Turns the model's one-sentence digest back into chips. The sentence is the
 * product surface; the chips are derived from it so the two can never disagree.
 */
function parseGroups(sentence: string, held: HeldSender[]): Digest['groups'] {
  const groups: Digest['groups'] = [];
  const claimed = new Set<string>();

  for (const category of CATEGORIES) {
    const match = sentence.match(new RegExp(`(\\d+)\\s+(?:looks like an?\\s+)?${category}`, 'i'));
    if (!match) continue;
    const count = Number(match[1]);
    if (!count) continue;

    const senderIds = held
      .filter((h) => h.category === category && !claimed.has(h.sender.id))
      .map((h) => h.sender.id);
    senderIds.forEach((id) => claimed.add(id));

    groups.push({ category, count, senderIds });
  }

  return groups;
}

export interface ScreenerAi {
  digest: Digest | null;
  digestState: AiState;
  retryDigest: () => void;
  /** Sender id → one-sentence read. Absent means the card omits the section. */
  reads: Record<string, string>;
}

/**
 * The Screener's two AI surfaces: the weekly digest and the per-sender read.
 * Both are governed by the "Read new senders for the Screener" toggle, and both
 * fail quietly — a failed read omits the card section rather than showing an
 * error on the card (§5.7).
 */
export function useScreenerAi(): ScreenerAi {
  const { client } = useAssistant();
  const { screenerReads } = useBehaviour();
  const held = useMail((s) => s.held);

  const [digest, setDigest] = useState<Digest | null>(null);
  const [digestState, setDigestState] = useState<AiState>('idle');
  const [reads, setReads] = useState<Record<string, string>>({});
  const readRequests = useRef(new Set<string>());

  const runDigest = useCallback(async () => {
    if (!client || held.length === 0) return;
    setDigestState('loading');
    try {
      const sentence = await client.digest(held);
      setDigest({ sentence, groups: parseGroups(sentence, held) });
      setDigestState('ready');
    } catch {
      setDigestState('failed');
    }
  }, [client, held]);

  useEffect(() => {
    if (!client || !screenerReads) {
      setDigest(null);
      setDigestState('idle');
      return;
    }
    if (held.length === 0) {
      setDigest(null);
      setDigestState('idle');
      return;
    }
    void runDigest();
    // Re-running on every held change would burn a call per decision; the digest
    // describes the queue as it stood when the Screener was opened.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, screenerReads, held.length === 0]);

  useEffect(() => {
    if (!client || !screenerReads) return;

    let cancelled = false;
    const pending = held.filter(
      (h) => !reads[h.sender.id] && !readRequests.current.has(h.sender.id),
    );
    if (pending.length === 0) return;

    // Only the cards a user will actually reach soon; the rest fill in as the
    // stack advances.
    for (const entry of pending.slice(0, 4)) {
      readRequests.current.add(entry.sender.id);
      void client
        .readSender(entry, { replyCount: entry.sender.replyCount ?? 0, frequentContacts: [] })
        .then((sentence) => {
          if (cancelled) return;
          setReads((prev) => ({ ...prev, [entry.sender.id]: sentence }));
        })
        .catch(() => {
          // §5.7 — a failed read omits the section. No error on the card.
        });
    }

    return () => {
      cancelled = true;
    };
  }, [client, screenerReads, held, reads]);

  return { digest, digestState, retryDigest: () => void runDigest(), reads };
}
