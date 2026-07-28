import { useEffect, useMemo, useRef, useState } from 'react';
import type { Thread } from '../types';
import type { ObligationRequest } from './types';
import { OBLIGATION_BATCH } from './client';
import { useAssistant, useBehaviour } from './useAssistant';
import { useMail } from '../store/mail';
import { useLedger as useLedgerStore, allObligations, type Obligation } from '../store/ledger';

/** How much of one conversation is worth handing to the pass. */
const MAX_TRANSCRIPT = 2400;

export interface LedgerView {
  needsYou: Obligation[];
  youPromised: Obligation[];
  waitingOn: Obligation[];
  /** A read is in flight; the lists may still grow. */
  thinking: boolean;
  /** How many conversations have been read at all. */
  read: number;
  total: number;
}

/**
 * The conversation's own state, as a cache key.
 *
 * Either half changes whenever the conversation does, and a reply is precisely
 * when an obligation may have been discharged — so it is precisely when the
 * previous read has to be thrown away.
 */
function stateKey(thread: Thread): string {
  return `${thread.lastMessageAt}:${thread.messageCount ?? thread.messages.length}`;
}

function daysSince(iso: string): number {
  const ms = Date.now() - new Date(iso).getTime();
  return Math.max(0, Math.floor(ms / 86_400_000));
}

/**
 * What the mailbox is asking of the reader.
 *
 * The one pass that looks across conversations rather than at the one on
 * screen. §7.9 already orders a summary's bullets so the last is "what is
 * being asked of the reader", naming the person and the deadline — the model
 * has been extracting this all along, once per thread, into a block nobody
 * reads unless they open that thread. This aggregates it into a list.
 *
 * Rows only, never bodies, are what the listing gives — so this reads threads
 * the store has already hydrated and asks the provider for nothing. A
 * conversation whose messages are a preview line is skipped rather than
 * guessed at: an obligation invented from a snippet would be worse than a
 * missing one.
 */
export function useLedger(threads: Thread[]): LedgerView {
  const { client } = useAssistant();
  const { readLedger } = useBehaviour();
  const account = useMail((s) => s.account);
  const found = useLedgerStore((s) => s.found);
  const done = useLedgerStore((s) => s.done);

  const [thinking, setThinking] = useState(false);
  const runningRef = useRef(false);

  const readable = useMemo(
    // A preview row carries one synthetic message; there is nothing to read.
    () => threads.filter((t) => !t.preview && t.messages.length > 0),
    [threads],
  );

  useEffect(() => {
    if (!client || !readLedger || runningRef.current) return;

    const me = (account?.email ?? '').toLowerCase();
    const store = useLedgerStore.getState();

    const pending: (ObligationRequest & { subject: string; at: string; key: string })[] = [];
    for (const thread of readable) {
      const key = stateKey(thread);
      if (!store.needsRead(thread.id, key)) continue;

      const other = thread.messages.find((m) => !m.isFromUser)?.from;
      const newest = thread.messages[thread.messages.length - 1];
      pending.push({
        key,
        threadId: thread.id,
        counterparty: other?.name || other?.email || 'Unknown',
        subject: thread.subject,
        at: thread.lastMessageAt,
        transcript: thread.messages
          .map((m) => `${m.isFromUser ? 'reader' : 'them'}: ${(m.body ?? '').replace(/\s+/g, ' ')}`)
          .join('\n')
          .slice(0, MAX_TRANSCRIPT),
        readerSpokeLast: (newest?.from.email ?? '').toLowerCase() === me,
        ageDays: daysSince(thread.lastMessageAt),
      });
    }
    if (pending.length === 0) return;

    runningRef.current = true;
    setThinking(true);

    /*
     * Runs to completion rather than aborting on cleanup, for the reason the
     * triage pass documents: the thread list changes identity on every archive
     * and every background refresh, and tearing the pass down each time threw
     * away answers for a batch already in flight while its threads stayed
     * marked as read.
     */
    void (async () => {
      try {
        for (let i = 0; i < pending.length; i += OBLIGATION_BATCH) {
          const batch = pending.slice(i, i + OBLIGATION_BATCH);
          try {
            const answers = await client.extractObligations(batch);
            for (const item of batch) {
              const mine = answers
                .filter((a) => a.threadId === item.threadId)
                .map((a) => ({
                  id: `${a.threadId}:${a.what}`,
                  threadId: a.threadId,
                  kind: a.kind,
                  what: a.what,
                  who: a.who,
                  due: a.due,
                  subject: item.subject,
                  at: item.at,
                }));
              /*
               * Recorded even when empty, and that is the point of recording
               * it: "read, owes nothing" is an answer worth keeping, and
               * without it every quiet thread would be re-read on every pass
               * for the rest of the mailbox's life.
               */
              useLedgerStore.getState().record(item.threadId, item.key, mine);
            }
          } catch {
            // One batch failing is one batch. The rest of the mailbox is still
            // worth reading, and an unread thread is simply asked again later.
          }
        }
      } finally {
        runningRef.current = false;
        setThinking(false);
      }
    })();
  }, [client, readLedger, readable, account]);

  return useMemo(() => {
    const doneSet = new Set(done);
    const open = allObligations({ found } as never).filter((o) => !doneSet.has(o.id));
    return {
      needsYou: open.filter((o) => o.kind === 'needs-you'),
      youPromised: open.filter((o) => o.kind === 'you-promised'),
      waitingOn: open.filter((o) => o.kind === 'waiting-on'),
      thinking,
      read: Object.keys(found).length,
      total: readable.length,
    };
  }, [found, done, thinking, readable.length]);
}
