import { useEffect, useMemo, useRef, useState } from 'react';
import type { HeldSender } from '../types';
import { tally, triage, type Suggestion, type TriageVerdict } from '../data/triage';
import { useMail } from '../store/mail';
import { useAssistant, useBehaviour } from './useAssistant';
import { TRIAGE_BATCH } from './client';
import type { TriageRequest } from './types';

export interface TriageView {
  /** Sender id → what Pigeon would do. Every held sender has an entry. */
  verdicts: Map<string, TriageVerdict>;
  /** Sender ids Pigeon would approve, and would decline. Never overlapping. */
  approve: string[];
  decline: string[];
  /** A model pass is in flight; the counts may still grow. */
  thinking: boolean;
}

/**
 * What Pigeon would do with the Screener queue.
 *
 * Rules first — a confident sales blast needs no model — and the rest go to
 * one, in small batches, because the Screener's hard cases are most of it. On
 * the demo account the deterministic pass settles two of twelve, which is the
 * honest number: telling a mail-merged recruiter from a real one is not a
 * regular expression's job.
 *
 * Nothing here decides anything. The output is a selection the user can accept
 * in one press, and reject by ignoring.
 */
export function useTriage(held: HeldSender[]): TriageView {
  const { client } = useAssistant();
  const { screenerReads } = useBehaviour();
  const deciding = useMail((s) => s.deciding);

  const [fromModel, setFromModel] = useState<Map<string, TriageVerdict>>(new Map());
  const [thinking, setThinking] = useState(false);
  const askedRef = useRef(new Set<string>());
  const runningRef = useRef(false);

  const fromRules = useMemo(() => {
    const map = new Map<string, TriageVerdict>();
    for (const h of held) map.set(h.sender.id, triage(h));
    return map;
  }, [held]);

  useEffect(() => {
    if (!client || !screenerReads) return;
    if (runningRef.current) return;

    const pending: TriageRequest[] = [];
    for (const h of held) {
      if (askedRef.current.has(h.sender.id)) continue;
      if (fromRules.get(h.sender.id)?.suggestion !== 'unsure') continue;
      pending.push({
        senderId: h.sender.id,
        from: `${h.sender.name} <${h.sender.email}>`,
        subject: h.messages[0]?.subject ?? '(no subject)',
        body: h.messages.map((m) => m.body ?? '').join(' '),
      });
    }
    if (pending.length === 0) return;

    runningRef.current = true;
    setThinking(true);

    /*
     * Runs to completion rather than aborting on cleanup. The Screener's held
     * list changes identity on every decision, and tearing the pass down each
     * time meant the answers for a batch already in flight were thrown away
     * while its senders stayed marked as asked — the same bug the lane pass
     * had, in a place where it would have been much harder to notice.
     */
    void (async () => {
      try {
        for (let i = 0; i < pending.length; i += TRIAGE_BATCH) {
          const batch = pending.slice(i, i + TRIAGE_BATCH);
          batch.forEach((item) => askedRef.current.add(item.senderId));
          try {
            const answers = await client.triageSenders(batch);
            setFromModel((prev) => {
              const next = new Map(prev);
              for (const a of answers) {
                next.set(a.senderId, {
                  suggestion: a.suggestion as Suggestion,
                  why: a.why,
                  confidence: 0.7,
                });
              }
              return next;
            });
          } catch {
            break;
          }
        }
      } finally {
        runningRef.current = false;
        setThinking(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, screenerReads, held, fromRules]);

  const verdicts = useMemo(() => {
    const map = new Map<string, TriageVerdict>();
    for (const h of held) {
      const rules = fromRules.get(h.sender.id);
      const model = fromModel.get(h.sender.id);
      // The rules only ever speak when they were sure, so a model answer never
      // overrules one — it fills the gap the rules left.
      map.set(h.sender.id, rules && rules.suggestion !== 'unsure' ? rules : (model ?? rules!));
    }
    return map;
  }, [held, fromRules, fromModel]);

  const counts = useMemo(() => tally(verdicts), [verdicts]);

  return {
    verdicts,
    approve: counts.approve,
    decline: counts.decline,
    // A decision in flight already removes its row optimistically; offering to
    // select rows that are mid-disappearance is offering a moving target.
    thinking: thinking || deciding > 0,
  };
}
