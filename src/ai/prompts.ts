/**
 * §7.9 — voice rules for AI-generated content. These govern the model's output,
 * not the UI chrome, and they are part of the spec because the copy is product
 * surface. Keep them verbatim; loosening them changes the product's voice.
 */

import type { DraftInput, SenderContext, Tone } from './types';
import type { HeldSender, Message, Thread } from '../types';
import { displayName, formatMessageTimestamp } from '../lib/format';

const UNIVERSAL = `You write inside Pigeon, a mail client.

Never use the first person. Never address the reader as "you" inside a summary.
No hedging openers ("It looks like", "It seems", "It appears"). No
meta-commentary ("Here's a summary"). No emoji. No exclamation marks. Never
restate the subject line. Output only what is asked for, with no preamble and no
closing remark.`;

export const SUMMARY_SYSTEM = `${UNIVERSAL}

Summarize a mail thread.

Rules:
- Maximum 3 bullets. Maximum 14 words per bullet.
- Each bullet is a complete statement of fact drawn from the thread, in past or
  present tense.
- Order: what changed, what the numbers are, what is being asked of the reader.
- If the thread contains a deadline or a request directed at the reader, that
  must be the final bullet and must name the person asking.
- Never speculate about intent. If the thread has no request, omit the third
  bullet rather than inventing one.

Output format: one bullet per line, each line starting with "- ". Nothing else.`;

export const READ_SYSTEM = `${UNIVERSAL}

Write one sentence explaining why a held message might matter to the reader.

Rules:
- Exactly one sentence. Maximum 18 words.
- Answer only "why might this matter", using evidence in the message and in the
  reader's own mail history.
- Preferred forms: "A warm intro from Dana Whitlock, who you email often." /
  "Cold sales mail from a list — no reply history." / "A support reply about a
  ticket you opened on Tuesday."
- Never a judgment word ("spam", "worthless", "important"). Never an instruction
  ("you should approve this"). Never a question.

Output format: the sentence alone. Nothing else.`;

export const DIGEST_SYSTEM = `${UNIVERSAL}

Write one sentence summarizing everyone waiting in the Screener.

Rules:
- One sentence with the total, then a breakdown by category with counts.
- Categories come from this fixed vocabulary only: junk, newsletters,
  recruiters, sales, support, client inquiry, personal, unclear.
- Format: "12 senders held: 9 junk, 2 recruiters, 1 looks like a client inquiry."
- Hedge only on the smallest, most consequential group, using "looks like".
- Never more than four categories; the remainder folds into "other".

Output format: the sentence alone. Nothing else.`;

const DRAFT_RULES = `Rules:
- No new facts. Every claim must be traceable to the thread.
- Any date, time, price, quantity, commitment, or attachment reference that is
  not present in the thread is emitted as [confirm: what is needed] — for
  example [confirm: a time on Thursday]. This is mandatory: never invent a
  detail to avoid a placeholder.
- Never longer than the message being replied to, unless the reply must answer
  multiple questions.
- Never sign off with the reader's full name unless their own sent mail does.
- Never include a subject line, and never add a postscript.

Output format: the body of the reply alone. No subject, no quoted text.`;

export function draftSystem(styleSamples: string[] | undefined): string {
  const register = styleSamples?.length
    ? `Match the register, greeting style, sign-off, and typical length of the reader's own sent mail, samples of which follow the thread.`
    : `Use a neutral professional register.`;

  return `${UNIVERSAL}

Write a reply on the reader's behalf. ${register}

${DRAFT_RULES}`;
}

const TONE_RULES: Record<Tone, string> = {
  shorter: `Remove sentences; never compress into jargon. Target 60% of the
current length. Keep every [confirm:] placeholder exactly as it is.`,
  friendlier: `Add a greeting and a closing courtesy, and soften imperatives to
requests. Do not add compliments or enthusiasm. Keep every [confirm:] placeholder
exactly as it is.`,
  firmer: `Remove hedges and apologies, and state the request as a direct ask
with a deadline if one exists in the thread. Do not add threats or escalation
language. Keep every [confirm:] placeholder exactly as it is.`,
};

export function toneSystem(tone: Tone): string {
  return `${UNIVERSAL}

Rewrite a draft reply. ${TONE_RULES[tone]}

Output format: the rewritten body alone.`;
}

/* -------------------------------------------------------------------------- */
/* User-turn builders                                                          */
/* -------------------------------------------------------------------------- */

/** Keeps a thread inside a sane token budget without truncating mid-message. */
const MAX_MESSAGE_CHARS = 4000;
const MAX_MESSAGES = 12;

function renderMessage(m: Message, userEmail: string): string {
  const who = m.from.email.toLowerCase() === userEmail.toLowerCase() ? 'the reader' : displayName(m.from);
  const body = m.body.length > MAX_MESSAGE_CHARS ? `${m.body.slice(0, MAX_MESSAGE_CHARS)}…` : m.body;
  return `From: ${who}\nDate: ${formatMessageTimestamp(m.date)}\n\n${body}`;
}

export function summaryUser(thread: Thread, userEmail: string): string {
  const messages = thread.messages.slice(-MAX_MESSAGES);
  return `Subject: ${thread.subject}\n\n${messages
    .map((m) => renderMessage(m, userEmail))
    .join('\n\n---\n\n')}`;
}

export function readUser(held: HeldSender, context: SenderContext): string {
  const first = held.messages[0];
  const history =
    context.replyCount > 0
      ? `The reader has sent this address ${context.replyCount} messages before.`
      : 'The reader has never written to this address.';
  const contacts = context.frequentContacts.length
    ? `People the reader emails often: ${context.frequentContacts.join(', ')}.`
    : '';

  return `Sender: ${held.sender.name} <${held.sender.email}>
Subject: ${first.subject}
${history}
${contacts}

${first.body.slice(0, MAX_MESSAGE_CHARS)}`;
}

export function digestUser(held: HeldSender[]): string {
  const lines = held.map(
    (h) => `- ${h.sender.name} <${h.sender.email}> — "${h.messages[0].subject}"`,
  );
  return `${held.length} senders are waiting:\n\n${lines.join('\n')}`;
}

export function draftUser(input: DraftInput): string {
  const parts: string[] = [];
  parts.push(`The reader is ${input.userName}.`);
  parts.push(`Reply to: ${input.recipients.join(', ')}`);
  parts.push(`Subject: ${input.subject}`);

  if (input.messages.length) {
    const thread = input.messages
      .slice(-MAX_MESSAGES)
      .map((m) => renderMessage(m, ''))
      .join('\n\n---\n\n');
    parts.push(`\nThread:\n\n${thread}`);
  } else {
    parts.push('\nThis is a new message; there is no thread to draw on.');
  }

  if (input.styleSamples?.length) {
    parts.push(
      `\nSamples of the reader's own sent mail:\n\n${input.styleSamples
        .slice(0, 3)
        .map((s) => s.slice(0, 1200))
        .join('\n\n---\n\n')}`,
    );
  }

  return parts.join('\n');
}

/* -------------------------------------------------------------------------- */
/* Output parsing                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Models occasionally emit internal XML or a leading preamble. Strip both rather
 * than showing them: a failed summary degrades to the thread (D39), but a
 * half-parsed one would look like Pigeon's own voice.
 */
export function cleanCompletion(text: string): string {
  return text
    .replace(/<thinking>[\s\S]*?<\/thinking>/gi, '')
    .replace(/<\/?[a-z_]+>/gi, '')
    .trim();
}

/** Summary bullets: one per line, `- ` prefixed, capped at 3 and 14 words. */
export function parseBullets(text: string): string[] {
  return cleanCompletion(text)
    .split('\n')
    .map((line) => line.replace(/^\s*[-•*]\s*/, '').trim())
    .filter(Boolean)
    .slice(0, 3)
    .map((line) => {
      const words = line.split(/\s+/);
      return words.length <= 14 ? line : `${words.slice(0, 14).join(' ')}…`;
    });
}

/** Single-sentence outputs: take the first sentence and cap it at `maxWords`. */
export function parseSentence(text: string, maxWords: number): string {
  const cleaned = cleanCompletion(text).split('\n')[0]?.trim() ?? '';
  const words = cleaned.split(/\s+/).filter(Boolean);
  return words.length <= maxWords ? cleaned : `${words.slice(0, maxWords).join(' ')}…`;
}
