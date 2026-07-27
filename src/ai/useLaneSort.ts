import { useEffect, useRef } from 'react';
import type { Thread } from '../types';
import { isGuess, LANES, threadSender, threadSignals, classify, type Lane } from '../data/lanes';
import { useLanes } from '../store/lanes';
import { useMail } from '../store/mail';
import { useSettings } from '../store/settings';
import { getAiClient, SORT_BATCH } from './client';
import type { SortRequest } from './types';

/**
 * The assistant's half of sorting.
 *
 * It is asked about the threads the deterministic pass was unsure of, and
 * about nothing else. That is the whole design: a `List-Unsubscribe` header
 * and a conversation the user is replying in are settled facts, and spending a
 * model call to relitigate them would be slower, more expensive and less
 * accurate than the two lines of code that already decided.
 *
 * What is left is the genuinely ambiguous middle — a product announcement with
 * no offer in it, a bulk mail from an address that could be a person — which
 * is where a model is actually better than a regular expression, and where the
 * user is most likely to disagree with a black box. So the answer is stored
 * with its reason, and the user can overrule it per sender, permanently.
 *
 * Everything here is best-effort. A failed batch leaves the rules' verdict in
 * place, shows nothing, and is not retried: the inbox was already sorted
 * before the model answered, and a sorting pass is not worth an error state.
 */

/**
 * How many unsure threads one visit will ask about.
 *
 * A first sync on a real account can produce hundreds. Grinding through all of
 * them on a local 3B model would hold the machine for minutes to improve rows
 * nobody has scrolled to, so this covers the top of the list and the rest are
 * picked up as the user works — which is also the order they matter in.
 */
const MAX_PER_VISIT = 40;

export function useLaneSort(threads: Thread[], place: 'inbox' | 'archive'): void {
  const enabled = useLanes((s) => s.enabled);
  const overrides = useLanes((s) => s.overrides);
  const assisted = useLanes((s) => s.assisted);
  const recordAssisted = useLanes((s) => s.recordAssisted);
  const provider = useSettings((s) => s.provider);
  const sortInbox = useSettings((s) => s.behaviour.sortInbox);
  const approved = useMail((s) => s.approved);

  /*
   * Threads asked about in this session, whatever the model said back. Without
   * it, a thread the model skipped or answered with a nonexistent lane is
   * still a guess on the next render, and the pass asks about it forever.
   */
  const askedRef = useRef(new Set<string>());
  const runningRef = useRef(false);

  useEffect(() => {
    if (!enabled || place !== 'inbox' || !sortInbox) return;
    if (runningRef.current) return;

    const client = getAiClient(provider);
    if (!client) return;

    const replied = new Set(
      approved.filter((s) => (s.replyCount ?? 0) > 0).map((s) => s.email.toLowerCase()),
    );
    const hasReplied = (email: string) => replied.has(email.toLowerCase());

    const pending: SortRequest[] = [];
    for (const thread of threads) {
      if (pending.length >= MAX_PER_VISIT) break;
      if (askedRef.current.has(thread.id) || assisted[thread.id]) continue;

      const sender = threadSender(thread);
      // The user's own word on this sender outranks everything, including a
      // model that has not been asked yet.
      if (overrides[sender.email.toLowerCase()]) continue;

      const signals = threadSignals(thread, hasReplied);
      if (!isGuess(classify(signals))) continue;

      pending.push({
        threadId: thread.id,
        from: sender.name ? `${sender.name} <${sender.email}>` : sender.email,
        subject: thread.subject || '(no subject)',
        preview: signals.text.slice(0, 240),
      });
    }

    if (pending.length === 0) return;

    let live = true;
    runningRef.current = true;

    void (async () => {
      for (let i = 0; i < pending.length; i += SORT_BATCH) {
        if (!live) break;
        const batch = pending.slice(i, i + SORT_BATCH);
        batch.forEach((item) => askedRef.current.add(item.threadId));

        try {
          const answers = await client.sortThreads(batch);
          if (!live) break;
          for (const answer of answers) {
            if (!LANES.includes(answer.lane as Lane)) continue;
            recordAssisted(answer.threadId, answer.lane as Lane, answer.why);
          }
        } catch {
          /*
           * One dead batch stops the pass rather than marching through the
           * rest. A local endpoint that has gone away fails every call, and
           * forty of those is forty seconds of a spinning machine for a
           * result the user was never promised.
           */
          break;
        }
      }
      runningRef.current = false;
    })();

    return () => {
      live = false;
      runningRef.current = false;
    };
    // `assisted` is deliberately absent: it changes on every recorded answer,
    // and depending on it would tear down the pass that is writing it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threads, enabled, place, sortInbox, provider, overrides, approved, recordAssisted]);
}
