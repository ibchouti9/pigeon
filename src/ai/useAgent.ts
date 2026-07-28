import { useCallback, useRef, useState } from 'react';
import { agentSystem, parseAgentTurn } from './prompts';
import { allowedWithoutAsking, findTool, TOOLS, type ToolRisk } from './tools';
import { useAssistant } from './useAssistant';
import { useSettings } from '../store/settings';

/** How many tool calls one question is allowed before it has to answer. */
const MAX_STEPS = 8;

export type AgentEntry =
  | { kind: 'you'; text: string }
  | { kind: 'pigeon'; text: string }
  /**
   * A tool that ran. `effect` is what changed; a read has none, and says what
   * it was looking for instead.
   */
  | { kind: 'did'; tool: string; effect?: string; looking?: string }
  /** Waiting on the user, because autonomy does not cover this one. */
  | { kind: 'ask'; tool: string; argument: string; risk: ToolRisk; describe: string };

export interface AgentView {
  entries: AgentEntry[];
  thinking: boolean;
  send: (question: string) => void;
  /** Answers a pending `ask`. */
  resolve: (approved: boolean) => void;
  clear: () => void;
}

/**
 * Pigeon's agent: a question, a few tool calls, an answer.
 *
 * The loop is deliberately shallow — one action per turn, the result fed back
 * before the next is chosen. A model that plans five steps before seeing the
 * result of the first is how the wrong conversation gets archived.
 *
 * Nothing about the permission gate is advisory. A tool the current autonomy
 * setting does not cover stops the loop and waits for the user; the model is
 * not asked to be careful, it is prevented.
 */
export function useAgent(): AgentView {
  const { client } = useAssistant();
  const autonomy = useSettings((s) => s.agentAutonomy);

  const [entries, setEntries] = useState<AgentEntry[]>([]);
  const [thinking, setThinking] = useState(false);

  /** The transcript as the model sees it: its own lines and tool results. */
  const historyRef = useRef<{ role: 'user' | 'assistant'; content: string }[]>([]);
  /** Resolves when the user answers a pending `ask`. */
  const pendingRef = useRef<((approved: boolean) => void) | null>(null);
  const runningRef = useRef(false);

  const add = (entry: AgentEntry) => setEntries((prev) => [...prev, entry]);

  const resolve = useCallback((approved: boolean) => {
    const waiting = pendingRef.current;
    pendingRef.current = null;
    // Drop the question from the transcript either way; it has been answered.
    setEntries((prev) => prev.filter((e) => e.kind !== 'ask'));
    waiting?.(approved);
  }, []);

  const send = useCallback(
    (question: string) => {
      const live = client;
      if (!live || runningRef.current || !question.trim()) return;

      add({ kind: 'you', text: question });
      historyRef.current.push({ role: 'user', content: question });
      runningRef.current = true;
      setThinking(true);

      void (async () => {
        try {
          const system = agentSystem(
            TOOLS.map((t) => t.usage),
            autonomy,
          );

          for (let step = 0; step < MAX_STEPS; step++) {
            /*
             * The streamed answer replaces itself in place: one `pigeon`
             * entry, growing. Appending would leave a column of partial
             * sentences behind the finished one.
             */
            let streamed = false;
            const turn = await live.agentTurn(system, historyRef.current, (soFar) => {
              if (!soFar) return;
              setEntries((prev) => {
                const next = [...prev];
                if (streamed && next[next.length - 1]?.kind === 'pigeon') {
                  next[next.length - 1] = { kind: 'pigeon', text: soFar };
                  return next;
                }
                streamed = true;
                return [...next, { kind: 'pigeon', text: soFar }];
              });
            });
            const parsed = parseAgentTurn(turn);

            if (parsed.kind === 'say') {
              historyRef.current.push({ role: 'assistant', content: `SAY: ${parsed.text}` });
              // Already on screen if it streamed; correct it to the parsed
              // text either way, which is what strips a trailing protocol line.
              setEntries((prev) => {
                if (streamed && prev[prev.length - 1]?.kind === 'pigeon') {
                  const next = [...prev];
                  next[next.length - 1] = { kind: 'pigeon', text: parsed.text };
                  return next;
                }
                return [...prev, { kind: 'pigeon', text: parsed.text }];
              });
              return;
            }

            if (streamed) {
              setEntries((prev) =>
                prev[prev.length - 1]?.kind === 'pigeon' ? prev.slice(0, -1) : prev,
              );
            }

            const tool = findTool(parsed.tool);
            if (!tool) {
              // Told, rather than shown an error: the model can recover from
              // this on the next turn, and the user never needed to see it.
              historyRef.current.push({
                role: 'assistant',
                content: `DO: ${parsed.tool} ${parsed.argument}`,
              });
              historyRef.current.push({
                role: 'user',
                content: `There is no tool called ${parsed.tool}.`,
              });
              continue;
            }

            historyRef.current.push({
              role: 'assistant',
              content: `DO: ${tool.name} ${parsed.argument}`,
            });

            if (!allowedWithoutAsking(tool.risk, autonomy)) {
              const approved = await new Promise<boolean>((accept) => {
                pendingRef.current = accept;
                add({
                  kind: 'ask',
                  tool: tool.name,
                  argument: parsed.argument,
                  risk: tool.risk,
                  describe:
                    tool.describe?.(parsed.argument) ??
                    `${tool.name} ${parsed.argument}`.trim(),
                });
              });
              if (!approved) {
                historyRef.current.push({
                  role: 'user',
                  content: 'The user declined that action. Do not try it again.',
                });
                continue;
              }
            }

            /*
             * Shown before it runs, not after.
             *
             * A local 32B takes several seconds a turn, so a three-step
             * question is most of a minute during which the panel said only
             * "Working…". An agent that has gone quiet is indistinguishable
             * from one that has hung, and the user's mailbox may be being
             * changed inside that silence. Every step is legible as it
             * happens; reads say what they are looking for and writes say
             * what they changed.
             */
            const pendingEntry: AgentEntry = {
              kind: 'did',
              tool: tool.name,
              looking: tool.narrate?.(parsed.argument),
            };
            if (pendingEntry.looking) add(pendingEntry);

            const result = await tool.run(parsed.argument);
            if (result.effect) {
              add({ kind: 'did', tool: tool.name, effect: result.effect });
            }
            historyRef.current.push({ role: 'user', content: result.observation });
          }

          /*
           * Out of steps. Said plainly rather than silently stopping — a panel
           * that just goes quiet reads as a crash, and the user's mailbox may
           * have been changed by the steps that did run.
           */
          add({
            kind: 'pigeon',
            text: "That took more steps than I'm allowed in one go. Ask me again and I'll carry on.",
          });
        } catch {
          add({ kind: 'pigeon', text: "Pigeon couldn't finish that. Try again." });
        } finally {
          pendingRef.current = null;
          runningRef.current = false;
          setThinking(false);
        }
      })();
    },
    [client, autonomy],
  );

  const clear = useCallback(() => {
    historyRef.current = [];
    pendingRef.current = null;
    setEntries([]);
  }, []);

  return { entries, thinking, send, resolve, clear };
}
