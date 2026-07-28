import type { AgentAutonomy } from '../store/settings';
import { useMail } from '../store/mail';
import { useCompose } from '../store/compose';
import { parseQuery } from '../data/query';

/**
 * What the agent can do to a mailbox.
 *
 * Deliberately small. Every tool here is either a read, or a write the user
 * could have made in one click and can undo in one more — with two exceptions
 * that are marked `reaches` and always ask, because they are the two that
 * involve somebody other than the user.
 *
 * The protocol is text rather than the provider's function-calling API. Every
 * other prompt in Pigeon uses a line format for the same reason: it works on a
 * 3B model on a laptop and on a frontier model behind an API, and Pigeon
 * supports both. A tool call that only works on half the providers is a
 * feature that is missing on half the providers.
 */

export type ToolRisk =
  /** Reads. Nothing changes. */
  | 'read'
  /** Changes the user's own mailbox, and has an undo. */
  | 'reversible'
  /** Reaches another person: a message sent, a sender silenced. */
  | 'reaches';

export interface ToolCall {
  name: string;
  /** Everything after the tool name, unparsed. */
  argument: string;
}

export interface ToolResult {
  /** What the model is told happened. Fed back into the loop verbatim. */
  observation: string;
  /** What the user is shown in the transcript. Absent for a plain read. */
  effect?: string;
}

export interface Tool {
  name: string;
  risk: ToolRisk;
  /** One line, shown to the model. */
  usage: string;
  run: (argument: string) => Promise<ToolResult>;
  /**
   * The action in the user's terms, for the confirmation.
   *
   * A prompt reading "archive t17" asks somebody to approve an identifier.
   * They cannot evaluate it, so they either say yes to everything or stop
   * using the setting — and both of those defeat the point of asking.
   */
  describe?: (argument: string) => string;
}

/** Whether this may run without stopping to ask, at this autonomy level. */
export function allowedWithoutAsking(risk: ToolRisk, autonomy: AgentAutonomy): boolean {
  if (risk === 'read') return true;
  if (risk === 'reversible') return autonomy === 'reversible' || autonomy === 'auto';
  // `reaches` is the one the middle setting deliberately does not cover.
  return autonomy === 'auto';
}

function threadLine(id: string, subject: string, from: string): string {
  return `${id} · ${from} · ${subject}`;
}

export const TOOLS: Tool[] = [
  {
    name: 'search',
    risk: 'read',
    usage: 'search <words> — find conversations. Returns id, sender and subject.',
    run: async (argument) => {
      const parsed = parseQuery(argument);
      const results = await useMail.getState().search(parsed.raw, false);
      const found = [...results.inbox, ...results.archive].slice(0, 8);
      if (found.length === 0) return { observation: `No conversations match "${argument}".` };
      return {
        observation: found
          .map((t) => {
            const from = [...t.messages].reverse().find((m) => !m.isFromUser)?.from;
            return threadLine(t.id, t.subject, from?.name || from?.email || 'Unknown');
          })
          .join('\n'),
      };
    },
  },
  {
    name: 'read',
    risk: 'read',
    usage: 'read <id> — the messages in one conversation.',
    run: async (argument) => {
      const id = argument.trim();
      try {
        const thread = await useMail.getState().provider.getThread(id);
        return {
          observation: `Subject: ${thread.subject}\n\n${thread.messages
            .map((m) => `${m.isFromUser ? 'you' : m.from.name || m.from.email}: ${m.body}`)
            .join('\n\n')
            .slice(0, 3000)}`,
        };
      } catch {
        return { observation: `No conversation with id ${id}.` };
      }
    },
  },
  {
    name: 'archive',
    risk: 'reversible',
    usage: 'archive <id> — move a conversation out of the inbox.',
    run: async (argument) => {
      const id = argument.trim();
      const thread = useMail.getState().inbox.find((t) => t.id === id);
      if (!thread) return { observation: `${id} is not in the inbox.` };
      await useMail.getState().setPlace(id, 'archive');
      return { observation: `Archived ${id}.`, effect: `Archived "${thread.subject}"` };
    },
    describe: (argument) => {
      const t = useMail.getState().inbox.find((x) => x.id === argument.trim());
      return t ? `Archive "${t.subject}"` : `Archive ${argument.trim()}`;
    },
  },
  {
    name: 'unread',
    risk: 'reversible',
    usage: 'unread <id> — leave a conversation unread.',
    run: async (argument) => {
      const id = argument.trim();
      const thread = useMail.getState().inbox.find((t) => t.id === id);
      if (!thread) return { observation: `${id} is not in the inbox.` };
      await useMail.getState().markRead(id, false);
      return { observation: `Marked ${id} unread.`, effect: `Left "${thread.subject}" unread` };
    },
    describe: (argument) => {
      const t = useMail.getState().inbox.find((x) => x.id === argument.trim());
      return t ? `Leave "${t.subject}" unread` : `Mark ${argument.trim()} unread`;
    },
  },
  {
    name: 'draft',
    risk: 'reversible',
    usage: 'draft <id> | <what to say> — open a reply in the composer. Never sends it.',
    run: async (argument) => {
      const [rawId, ...rest] = argument.split('|');
      const id = rawId.trim();
      const thread = await useMail.getState().provider.getThread(id).catch(() => null);
      if (!thread) return { observation: `No conversation with id ${id}.` };

      const other = [...thread.messages].reverse().find((m) => !m.isFromUser)?.from;
      useCompose.getState().close();
      useCompose.getState().open({
        threadId: thread.id,
        mode: 'reply',
        subject: thread.subject.startsWith('Re:') ? thread.subject : `Re: ${thread.subject}`,
        to: other ? [other] : [],
        body: rest.join('|').trim(),
      });
      /*
       * The composer, not the outbox. A draft the user has to look at and
       * press Send on is the whole difference between an agent that helps and
       * one that speaks for you — and it is why `draft` is reversible rather
       * than `reaches`.
       */
      return {
        observation: `Opened a draft reply to ${other?.name ?? 'them'} on ${id}. It is not sent.`,
        effect: `Drafted a reply to ${other?.name ?? 'them'}`,
      };
    },
    describe: (argument) => {
      const id = argument.split('|')[0].trim();
      const t = [...useMail.getState().inbox, ...useMail.getState().sent].find((x) => x.id === id);
      return t ? `Draft a reply on "${t.subject}"` : `Draft a reply on ${id}`;
    },
  },
  {
    name: 'approve',
    risk: 'reaches',
    usage: 'approve <sender id> — let a held sender into the inbox.',
    run: async (argument) => {
      const id = argument.trim();
      const ok = await useMail.getState().decide(id, 'approved');
      return ok
        ? { observation: `Approved ${id}.`, effect: `Approved ${id}` }
        : { observation: `${id} is not waiting in the Screener.` };
    },
    describe: (argument) => {
      const held = useMail.getState().held.find((h) => h.sender.id === argument.trim());
      return held ? `Let ${held.sender.name} into your inbox` : `Approve ${argument.trim()}`;
    },
  },
  {
    name: 'decline',
    risk: 'reaches',
    usage: 'decline <sender id> — silence a held sender for good.',
    run: async (argument) => {
      const id = argument.trim();
      const ok = await useMail.getState().decide(id, 'declined');
      return ok
        ? { observation: `Declined ${id}.`, effect: `Declined ${id}` }
        : { observation: `${id} is not waiting in the Screener.` };
    },
    describe: (argument) => {
      const held = useMail.getState().held.find((h) => h.sender.id === argument.trim());
      return held ? `Silence ${held.sender.name} for good` : `Decline ${argument.trim()}`;
    },
  },
];

export function findTool(name: string): Tool | undefined {
  return TOOLS.find((t) => t.name === name.toLowerCase());
}
