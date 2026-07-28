import { useEffect, useRef } from 'react';
import { useMail } from '../store/mail';
import { threadSender } from '../data/lanes';
import { displayName, formatCount } from '../lib/format';
import { mayNotify, notify } from '../lib/notify';
import type { Thread } from '../types';

/**
 * The one thing Pigeon is willing to interrupt someone for.
 *
 * "Approved senders only" needs no sender lookup, because the Screener has
 * already done it: mail from someone you have not chosen is in `held`, not in
 * `inbox`. So a new thread in the inbox *is* a new thread from someone you
 * chose, and the whole product thesis arrives at the notification layer for
 * free. The Screener fills up in silence, which is the point of it.
 */

/**
 * Notifying about five arrivals with five notifications is how a mail client
 * teaches someone to turn its notifications off. Past this many, they are
 * summarised into one.
 */
const NAME_LIMIT = 3;

function noticeFor(threads: Thread[]): { title: string; body: string } {
  if (threads.length === 1) {
    const thread = threads[0];
    return {
      title: displayName(threadSender(thread)),
      body: thread.subject || '(no subject)',
    };
  }

  const names: string[] = [];
  for (const thread of threads) {
    const name = displayName(threadSender(thread));
    if (!names.includes(name)) names.push(name);
  }
  const shown = names.slice(0, NAME_LIMIT).join(', ');
  const rest = names.length - NAME_LIMIT;
  return {
    title: `${formatCount(threads.length)} new messages`,
    body: rest > 0 ? `${shown} and ${formatCount(rest)} more` : shown,
  };
}

export function useNewMailNotice(): void {
  const inbox = useMail((s) => s.inbox);
  const status = useMail((s) => s.status.inbox);

  /*
   * Every thread id the inbox has held since this shell mounted.
   *
   * A set of ids rather than a timestamp, because "newer than the last thing I
   * saw" is wrong twice over: mail arrives out of order — a message delayed
   * upstream lands with an older `lastMessageAt` than one already listed — and
   * a thread that gets a reply is not a thread that arrived.
   */
  const seen = useRef<Set<string> | null>(null);

  useEffect(() => {
    if (status !== 'ready') return;

    /*
     * The first ready listing is the baseline, not an event. Without this,
     * opening Pigeon notifies you about every unread conversation you already
     * knew about — and on a real account that is a notification per unread
     * thread, at launch, every launch.
     */
    if (seen.current === null) {
      seen.current = new Set(inbox.map((t) => t.id));
      return;
    }

    const known = seen.current;
    const arrived = inbox.filter((t) => !known.has(t.id));
    for (const thread of inbox) known.add(thread.id);

    /*
     * Unread, and not the user's own. A thread Pigeon itself just moved back
     * out of the archive is new to this list and is not new mail; a message
     * the user sent appears in the inbox thread they sent it from.
     */
    const worth = arrived.filter((t) => t.unread && !t.messages.every((m) => m.isFromUser));
    if (worth.length === 0) return;

    void (async () => {
      if (!(await mayNotify())) return;
      await notify(noticeFor(worth));
    })();
  }, [inbox, status]);
}
