import type { Address, Draft, Thread } from '../../types';
import type { ReplyMode } from './ThreadReader';

let counter = 0;

/** Seeds a reply, reply-all or forward from the thread's last message. */
export function buildReplyDraft(
  thread: Thread,
  mode: ReplyMode,
  selfEmail: string,
): Draft {
  const last = thread.messages[thread.messages.length - 1];
  const bare = thread.subject.replace(/^(re|fwd):\s*/i, '');

  let to: Address[] = [];
  if (last && mode === 'reply') {
    to = last.isFromUser ? last.to : [last.from];
  } else if (last && mode === 'reply-all') {
    const seen = new Set<string>([selfEmail.toLowerCase()]);
    to = [last.from, ...last.to, ...last.cc].filter((a) => {
      const key = a.email.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  return {
    id: `reply-${++counter}`,
    to,
    cc: [],
    bcc: [],
    subject: mode === 'forward' ? `Fwd: ${bare}` : `Re: ${bare}`,
    body: '',
    threadId: thread.id,
    mode,
    aiState: 'none',
  };
}

