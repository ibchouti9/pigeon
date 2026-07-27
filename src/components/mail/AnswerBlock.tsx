import { Fragment, type ReactNode } from 'react';
import { cn } from '../../lib/cn';
import type { Thread } from '../../types';
import { displayName } from '../../lib/format';
import { Button } from '../primitives/Button';
import type { MailAnswer } from '../../ai/useMailAnswer';
import styles from './AnswerBlock.module.css';

export interface AnswerBlockProps {
  answer: MailAnswer;
  onOpenThread: (id: string) => void;
}

/**
 * Renders `[2]` as a link to the second cited thread, and leaves the rest of
 * the sentence alone. A citation the user cannot follow is decoration.
 */
function withCitations(text: string, cited: Thread[], onOpen: (id: string) => void): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let key = 0;

  for (const match of text.matchAll(/\[(\d+)\]/g)) {
    const at = match.index ?? 0;
    if (at > last) out.push(<Fragment key={key++}>{text.slice(last, at)}</Fragment>);
    last = at + match[0].length;

    /*
     * `cited` is in the order the answer used them, which is the order the
     * numbers appear — so [2] is the second distinct citation, not the second
     * source Pigeon sent. A number pointing at a thread that isn't there
     * renders as plain text rather than a dead link.
     */
    const n = Number(match[1]);
    const thread = cited[nthDistinct(text, n)];
    if (!thread) {
      out.push(<Fragment key={key++}>{match[0]}</Fragment>);
      continue;
    }

    out.push(
      <button
        key={key++}
        type="button"
        className={cn('t-xs', styles.cite)}
        title={thread.subject}
        onClick={() => onOpen(thread.id)}
      >
        {match[1]}
      </button>,
    );
  }

  if (last < text.length) out.push(<Fragment key={key++}>{text.slice(last)}</Fragment>);
  return out;
}

/** Where `n` falls in the order the answer first mentioned each number. */
function nthDistinct(text: string, n: number): number {
  const order: number[] = [];
  for (const m of text.matchAll(/\[(\d+)\]/g)) {
    const v = Number(m[1]);
    if (!order.includes(v)) order.push(v);
  }
  return order.indexOf(n);
}

/**
 * The answer above the results.
 *
 * Nothing here runs on its own. A question typed into a search box is very
 * often just a search, so Pigeon offers a button and waits — and the answer,
 * when it comes, is three sentences over the threads on screen with every
 * claim numbered and clickable. "Not in this mail" is a first-class outcome
 * and is styled as an answer rather than an error, because a grounded model
 * saying it does not know is the feature working.
 */
export function AnswerBlock({ answer, onOpenThread }: AnswerBlockProps) {
  if (answer.state === 'idle') return null;

  if (answer.state === 'offered') {
    return (
      <div className={styles.offer}>
        <Button variant="secondary" size="sm" onClick={answer.ask}>
          Answer this from your mail
        </Button>
        <span className={cn('t-xs', styles.offerNote)}>Reads only the results below</span>
      </div>
    );
  }

  if (answer.state === 'thinking') {
    return (
      <div className={cn(styles.block, styles.thinking)} aria-live="polite">
        <span className={cn('t-sm', styles.thinkingText)}>Reading the results…</span>
      </div>
    );
  }

  if (answer.state === 'failed') {
    return (
      <div className={styles.block} role="status">
        <p className={cn('t-sm', styles.body)}>
          Pigeon couldn't answer that. The results are below.
        </p>
        <div className={styles.actions}>
          <Button variant="tertiary" size="sm" onClick={answer.ask}>
            Try again
          </Button>
          <Button variant="tertiary" size="sm" onClick={answer.dismiss}>
            Hide
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.block} aria-live="polite">
      <p className={cn('t-md', styles.body)}>
        {withCitations(answer.text, answer.cited, onOpenThread)}
        {/*
          A caret while text is arriving. Without it the answer stops mid
          sentence for a second at a time and reads as finished-and-truncated
          rather than as still being written.
        */}
        {answer.streaming && <span className={styles.caret} aria-hidden="true" />}
      </p>

      {/*
        The sources list waits for the end. Citations are only known once the
        answer stops — a list that grows a row at a time under a sentence that
        is also growing is two things moving at once for no reason.
      */}
      {!answer.streaming && answer.cited.length > 0 && (
        <ul className={styles.sources}>
          {answer.cited.map((thread, i) => {
            const from = [...thread.messages].reverse().find((m) => !m.isFromUser)?.from;
            return (
              <li key={thread.id}>
                <button
                  type="button"
                  className={cn('t-xs', styles.source)}
                  onClick={() => onOpenThread(thread.id)}
                >
                  <span className={styles.sourceNum}>{i + 1}</span>
                  <span className={styles.sourceText}>
                    {from ? displayName(from) : 'Unknown'} — {thread.subject}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {!answer.streaming && (
        <div className={styles.actions}>
          <span className={cn('t-xs', styles.provenance)}>
            {answer.refused
              ? 'Nothing in the results answered it.'
              : 'From the results below only.'}
          </span>
          <Button variant="tertiary" size="sm" onClick={answer.dismiss}>
            Hide
          </Button>
        </div>
      )}
    </div>
  );
}
