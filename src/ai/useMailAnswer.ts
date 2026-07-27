import { useCallback, useEffect, useRef, useState } from 'react';
import type { Thread } from '../types';
import { parseQuery } from '../data/query';
import { useSettings } from '../store/settings';
import { getAiClient, ANSWER_SOURCES } from './client';
import type { AnswerRequest } from './types';

export type AnswerState = 'idle' | 'offered' | 'thinking' | 'ready' | 'failed';

export interface MailAnswer {
  state: AnswerState;
  /** The answer, with `[n]` citations still in it for the UI to render. */
  text: string;
  /** Threads the answer cited, in the order it cited them. */
  cited: Thread[];
  /** The mail did not contain an answer, and the model said so. */
  refused: boolean;
  /** The question this answer belongs to, so a stale one is never shown. */
  question: string;
  ask: () => void;
  dismiss: () => void;
}

/**
 * Answering a question out of the threads the search already found.
 *
 * Retrieval is the term search. There is no index, no embedding store and
 * nothing precomputed: the same ranked results the user is looking at are the
 * only thing the model is shown, which is what makes the citations meaningful
 * — every claim is one click from the message it came from.
 *
 * It never runs on its own. A question in a search box is often just a search,
 * the model call costs a second or two of a laptop's attention, and a summary
 * that appears over results the user was already reading is an interruption.
 * Pigeon offers; the user asks.
 */
export function useMailAnswer(
  query: string,
  results: Thread[],
  resultsReady: boolean,
): MailAnswer {
  const provider = useSettings((s) => s.provider);

  const [state, setState] = useState<AnswerState>('idle');
  const [text, setText] = useState('');
  const [cited, setCited] = useState<Thread[]>([]);
  const [refused, setRefused] = useState(false);
  const [answered, setAnswered] = useState('');
  const [dismissed, setDismissed] = useState<string | null>(null);

  const request = useRef(0);
  const parsed = parseQuery(query);
  const client = getAiClient(provider);
  const offerable =
    parsed.isQuestion && resultsReady && results.length > 0 && client !== null;

  /*
   * A new question is a new answer. Without this, editing the query left the
   * previous answer sitting above results it no longer describes — the worst
   * possible failure for a feature whose whole claim is that it is grounded in
   * what is on screen.
   */
  useEffect(() => {
    request.current += 1;
    setState('idle');
    setText('');
    setCited([]);
    setRefused(false);
    setAnswered('');
  }, [query]);

  const ask = useCallback(() => {
    const live = getAiClient(useSettings.getState().provider);
    if (!live) return;

    const id = ++request.current;
    setState('thinking');

    const sources: AnswerRequest[] = results.slice(0, ANSWER_SOURCES).map((t) => {
      const newest = [...t.messages].reverse().find((m) => !m.isFromUser) ?? t.messages[0];
      return {
        threadId: t.id,
        from: newest ? `${newest.from.name} <${newest.from.email}>` : '',
        subject: t.subject,
        date: t.lastMessageAt.slice(0, 10),
        // Newest first: on a long thread the oldest message is the least
        // likely to hold the answer and the most likely to fill the context.
        body: [...t.messages]
          .reverse()
          .map((m) => m.body ?? '')
          .join('\n\n'),
      };
    });

    void live
      .answer(query, sources)
      .then((result) => {
        if (id !== request.current) return;
        setText(result.text);
        setRefused(result.refused);
        setCited(
          result.cited
            .map((threadId) => results.find((t) => t.id === threadId))
            .filter((t): t is Thread => Boolean(t)),
        );
        setAnswered(query);
        setState('ready');
      })
      .catch(() => {
        if (id !== request.current) return;
        setState('failed');
      });
  }, [query, results]);

  const dismiss = useCallback(() => {
    setDismissed(query);
    setState('idle');
  }, [query]);

  const hidden = dismissed === query;

  return {
    state: hidden ? 'idle' : state === 'idle' && offerable ? 'offered' : state,
    text,
    cited,
    refused,
    question: answered,
    ask,
    dismiss,
  };
}
