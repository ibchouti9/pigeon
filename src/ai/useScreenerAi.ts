import { useEffect, useRef, useState } from 'react';
import { useAssistant, useBehaviour } from './useAssistant';
import { useMail } from '../store/mail';

export interface ScreenerAi {
  /** Sender id → one-sentence read. Absent means the card omits the section. */
  reads: Record<string, string>;
}

/**
 * The per-sender read behind each Screener card.
 *
 * This used to also produce the weekly digest — one model call for a sentence
 * summarising the queue. It was removed rather than fixed. The prompt handed
 * the model a user message opening "12 senders are waiting:" and the model
 * answered by completing that line and listing everyone underneath, so the
 * digest block rendered "12 senders are waiting:" with a dangling colon and
 * nothing after it.
 *
 * It could have been fixed. It was deleted because `useTriage` answers the
 * same question better: a count per outcome, derived from per-sender verdicts
 * the Screener already has, that cannot disagree with the rows below it and
 * costs no extra call.
 *
 * How far ahead of the top card the stack pre-fetches reads: the stack shows
 * one sender at a time, and bulk review renders triage evidence rather than
 * these.
 */
const STACK_LOOKAHEAD = 4;

export function useScreenerAi(): ScreenerAi {
  const { client } = useAssistant();
  const { screenerReads } = useBehaviour();
  const held = useMail((s) => s.held);

  const [reads, setReads] = useState<Record<string, string>>({});
  const readRequests = useRef(new Set<string>());
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (!client || !screenerReads) return;

    // `readRequests` is the dedupe, not `reads` — keeping `reads` out of the
    // deps is what stops each arriving read from re-running this effect.
    const pending = held.filter((h) => !readRequests.current.has(h.sender.id));
    if (pending.length === 0) return;

    // Only the cards the user will actually reach soon; the rest fill in as
    // the stack advances.
    for (const entry of pending.slice(0, STACK_LOOKAHEAD)) {
      readRequests.current.add(entry.sender.id);
      void client
        .readSender(entry, { replyCount: entry.sender.replyCount ?? 0, frequentContacts: [] })
        .then((sentence) => {
          // Guarding on unmount only. An earlier attempt cancelled on every
          // dependency change, which meant the first read to arrive discarded
          // its own still-in-flight siblings and no card ever showed one.
          if (!mounted.current) return;
          setReads((prev) => ({ ...prev, [entry.sender.id]: sentence }));
        })
        .catch(() => {
          // §5.7 — a failed read omits the section, with no error on the card.
          // But release the dedupe: leaving the id marked as requested meant a
          // single provider hiccup silently disabled that sender's read for the
          // rest of the session, even if they left the queue and came back.
          readRequests.current.delete(entry.sender.id);
        });
    }
  }, [client, screenerReads, held]);

  return { reads };
}
