import { useEffect, useRef, useState } from 'react';
import { useAgent } from '../../ai/useAgent';
import { useAssistant } from '../../ai/useAssistant';
import { useUi } from '../../store/ui';
import { useSettings } from '../../store/settings';
import { Button } from '../primitives/Button';
import { Icon } from '../primitives/Icon';
import { Input } from '../primitives/Field';
import { cn } from '../../lib/cn';
import styles from './AgentPanel.module.css';

const SUGGESTIONS = [
  'What needs me today?',
  'Anything from Dana I have not answered?',
  'Archive the newsletters in my inbox',
];

/**
 * A conversation with the mailbox.
 *
 * The panel shows three kinds of thing and keeps them visually distinct on
 * purpose: what was said, what was *done*, and what is being asked. A mailbox
 * that changed while the user was reading a paragraph is the failure mode of
 * every agent, and the only defence is that the change is as legible as the
 * prose around it.
 *
 * ## Known: it overlaps the composer dock
 *
 * Both are fixed to the right edge, so with a composer open the panel covers
 * it — measured at 1280px, an overlap of 372px. It matters because the
 * agent's own `draft` tool opens the composer, so asking it to write a reply
 * puts the reply behind the panel that wrote it.
 *
 * An attempt to move the dock left while the panel is open did not land, and
 * is worth knowing about before trying again: with the class applied, the
 * media query matching, and `right` set as an inline style — which nothing in
 * the sheets marks `!important` — `getComputedStyle(dock).right` stayed at
 * 24px and the element did not move. Not a specificity problem and not an
 * invalid `calc()`; both were ruled out directly in the browser. Something
 * else is deciding that box, and finding it is the actual task.
 */
export function AgentPanel() {
  const open = useUi((s) => s.agentOpen);
  const setOpen = useUi((s) => s.setAgentOpen);
  const autonomy = useSettings((s) => s.agentAutonomy);
  const { connected } = useAssistant();
  const agent = useAgent();

  const [text, setText] = useState('');
  const logRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  if (!open) return null;

  function submit(question: string) {
    setText('');
    agent.send(question);
  }

  return (
    <aside className={styles.panel} aria-label="Assistant">
      <div className={styles.head}>
        <span className="t-base">Assistant</span>
        <div className={styles.headActions}>
          {agent.entries.length > 0 && (
            <Button variant="tertiary" size="sm" onClick={agent.clear}>
              Clear
            </Button>
          )}
          <Button
            variant="icon"
            size="sm"
            aria-label="Close assistant"
            onClick={() => setOpen(false)}
          >
            <Icon name="close" size={16} />
          </Button>
        </div>
      </div>

      <div className={styles.log} ref={logRef}>
        {!connected ? (
          <p className={cn('t-sm', styles.empty)}>
            The assistant needs a model. Connect one in Settings.
          </p>
        ) : agent.entries.length === 0 ? (
          <>
            <p className={cn('t-sm', styles.empty)}>
              Ask about your mail, or tell Pigeon what to do with it.
            </p>
            <div className={styles.suggestions}>
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  className={cn('t-sm', styles.suggestion)}
                  onClick={() => submit(s)}
                >
                  {s}
                </button>
              ))}
            </div>
          </>
        ) : (
          agent.entries.map((entry, i) => {
            if (entry.kind === 'you') {
              return (
                <p key={i} className={cn('t-sm', styles.you)}>
                  {entry.text}
                </p>
              );
            }
            if (entry.kind === 'pigeon') {
              return (
                <p key={i} className={cn('t-sm', styles.pigeon)}>
                  {entry.text}
                </p>
              );
            }
            if (entry.kind === 'did') {
              // A read says what it is looking for and carries no tick; a
              // write says what it changed and does.
              return (
                <p key={i} className={cn('t-xs', entry.effect ? styles.did : styles.looking)}>
                  {entry.effect ? <Icon name="check" size={16} /> : null}
                  {entry.effect ?? entry.looking}
                </p>
              );
            }
            return (
              <div key={i} className={styles.ask} role="group" aria-label="Confirm action">
                <span className={cn('t-sm', styles.askWhat)}>{entry.describe}</span>
                <span className={cn('t-xs', styles.askNote)}>
                  {entry.risk === 'reaches'
                    ? 'This one reaches somebody else, so Pigeon always asks.'
                    : 'Your setting is to be asked first.'}
                </span>
                <div className={styles.askActions}>
                  <Button variant="primary" size="sm" onClick={() => agent.resolve(true)}>
                    Do it
                  </Button>
                  <Button variant="tertiary" size="sm" onClick={() => agent.resolve(false)}>
                    No
                  </Button>
                </div>
              </div>
            );
          })
        )}

        {agent.thinking && (
          <p className={cn('t-xs', styles.did)} role="status">
            Working…
          </p>
        )}
      </div>

      <form
        className={styles.composer}
        onSubmit={(e) => {
          e.preventDefault();
          submit(text);
        }}
      >
        <Input
          ref={inputRef}
          className={styles.input}
          size="xs"
          value={text}
          placeholder={autonomy === 'ask' ? 'Ask, and confirm each step' : 'Ask about your mail'}
          aria-label="Ask the assistant"
          disabled={!connected}
          onChange={(e) => setText(e.currentTarget.value)}
        />
        <Button variant="primary" size="sm" disabled={!connected || !text.trim()}>
          Send
        </Button>
      </form>
    </aside>
  );
}
