import { useCallback, useEffect, useRef, useState } from 'react';
import type { Thread } from '../types';
import { displayName } from '../lib/format';
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
  /** Text is still arriving. The citations are not known until it stops. */
  streaming: boolean;
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
/**
 * One thread, as text a model can answer questions about.
 *
 * Every line is attributed, and that is the entire point of this function.
 * The bodies used to be concatenated with nothing between them, which threw
 * away the one fact most questions turn on — who said it. "What did I promise
 * Dana" is unanswerable from a wall of text in which the reader's own
 * sentences are indistinguishable from Dana's, and the model correctly refused
 * with "Not in this mail." on a thread that plainly contained the answer.
 *
 * "You" rather than the account's own name, because that is how the question
 * will be phrased.
 *
 * Newest first: on a long thread the oldest message is the least likely to
 * hold the answer and the most likely to fill the context, and the prompt
 * truncates from the end.
 */
export function conversationText(thread: Thread): string {
  return [...thread.messages]
    .reverse()
    .map((m) => `${m.isFromUser ? 'You' : displayName(m.from)}: ${m.body ?? ''}`.trim())
    .join('\n\n');
}

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
  const [streaming, setStreaming] = useState(false);

  const request = useRef(0);
  const parsed = parseQuery(query);
  const client = getAiClient(provider);
  const offerable =
    parsed.isQuestion && resultsReady && results.length > 0 && client !== null;
  const autoAnswer = useSettings((s) => s.behaviour.answerQuestions);

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
    setStreaming(false);
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
        body: conversationText(t),
      };
    });

    void live
      .answer(query, sources, (soFar) => {
        if (id !== request.current) return;
        // First token flips the state: a spinner that keeps spinning while
        // words appear underneath it is the app arguing with itself.
        setState('ready');
        setStreaming(true);
        setText(soFar);
      })
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
        setStreaming(false);
        setState('ready');
      })
      .catch(() => {
        if (id !== request.current) return;
        setStreaming(false);
        setState('failed');
      });
  }, [query, results]);

  /*
   * Asked without being asked for, when the setting allows it.
   *
   * `parseQuery` has already decided this reads as a question before anything
   * here runs, so the button was a second confirmation of a call Pigeon had
   * made. The other three assistant surfaces — summaries, Screener reads, lane
   * sorting — all run on their own and are switched off in the same place.
   *
   * Still nothing to undo and nothing sent anywhere the results did not
   * already come from: the answer reads the threads on screen, and dismissing
   * it leaves them.
   */
  useEffect(() => {
    if (!autoAnswer || !offerable) return;
    if (state !== 'idle' || dismissed === query) return;
    ask();
  }, [autoAnswer, offerable, state, dismissed, query, ask]);

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
    streaming,
    question: answered,
    ask,
    dismiss,
  };
}
