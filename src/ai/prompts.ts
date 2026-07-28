/**
 * §7.9 — voice rules for AI-generated content. These govern the model's output,
 * not the UI chrome, and they are part of the spec because the copy is product
 * surface. Keep them verbatim; loosening them changes the product's voice.
 */

import type { DraftInput, Tone } from './types';
import type { Message, Thread } from '../types';
import { displayName, formatMessageTimestamp } from '../lib/format';

/**
 * The rules that hold whoever the words are for.
 *
 * §7.9's "Universal" block also forbids the first person, and that half is
 * split out below rather than kept here — see `PIGEON_VOICE`.
 */
const UNIVERSAL = `You write inside Pigeon, a mail client.

No hedging openers ("It looks like", "It seems", "It appears"). No
meta-commentary ("Here's a summary"). No emoji. No exclamation marks. Never
restate the subject line. Output only what is asked for, with no preamble and no
closing remark.`;

/**
 * Pigeon speaking about the mail — a summary, a Screener read, a lane's
 * evidence. §7.9's first-person ban belongs here and only here.
 *
 * Applied to draft replies as well, it produced subject-less telegram English:
 * measured against qwen2.5:32b, a reply to a contract thread came back as
 * "Agreed to push back on the tooling clause per Sana's note. On the liability
 * cap, willing to accept $750K as compromise." Nobody writes like that, and
 * §7.9's own Draft Replies section asks the model to match the register of the
 * reader's sent mail — which is first person by construction. The two halves
 * of the section contradict each other; this resolves it by scope, because a
 * reply is written *as* the reader and a summary is written *about* them.
 */
const PIGEON_VOICE = `${UNIVERSAL}

Never use the first person. Never address the reader as "you" inside a summary.`;

export const SUMMARY_SYSTEM = `${PIGEON_VOICE}

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

/**
 * The sorting pass.
 *
 * Asked only about threads the deterministic rules were unsure of, which is
 * why the prompt can afford to be strict: there is no cheap fallback left, and
 * a model that invents a sixth lane produces a thread that lands nowhere.
 *
 * A line format rather than JSON. A 3B model running on someone's laptop is
 * the target, and those emit `1: … — promotions` reliably and well-formed JSON
 * about as often as they don't. The parser also has to survive a model that
 * wraps its answer in prose, which `parseLaneLines` does by reading only the
 * lines that match.
 *
 * The evidence comes *before* the lane, and that ordering is the single
 * biggest accuracy lever in this file. Asked for the label first, llama3.2:3b
 * answered a five-email batch by walking straight down the list of lanes in
 * the order the prompt happened to name them — people, promotions,
 * newsletters, receipts, notifications — while writing reasons underneath that
 * contradicted its own labels. Made to state the evidence first, the same
 * model on the same batch got every one right, in half the time.
 */
export const SORT_SYSTEM = `${PIGEON_VOICE}

Sort each email into exactly one lane.

The lanes, and what belongs in each:
- people: a person wrote this to the reader, by hand.
- newsletters: a publication or an author's list the reader subscribed to.
- promotions: marketing, sales outreach, offers, product pitches.
- receipts: orders, payments, invoices, bookings, tickets, shipping.
- notifications: automatic mail from a service — codes, alerts, build results.

Rules:
- Use only those five words. Never invent a lane, never leave one blank.
- Judge by who sent it and why, not by whether it looks useful.
- Cold sales outreach written by a named human is promotions, not people.
- A service email a human never typed is notifications, even if it is friendly.
- Several emails in a batch often belong in the same lane. Answer each one on
  its own evidence; never vary the answer for the sake of variety.
- The evidence is a statement about the email. Never quote the sender's address
  back, never repeat the subject line, never write the word "from".

For each email, state the evidence first, in at most 7 words, and let the lane
follow from it.

Output format: one line per email, exactly \`<number>: <evidence> — <lane>\`.
No preamble, no numbering of your own, no blank lines.`;

/**
 * Answering a question from the user's own mail.
 *
 * The retrieval is the term search that already exists, which means this is
 * grounded in whatever that found and nothing else — no memory, no training
 * data, no guessing. Everything about the prompt is aimed at the one failure
 * that would make the feature worse than useless: a confident answer to a
 * question the mail does not contain.
 */
export const ANSWER_SYSTEM = `${PIGEON_VOICE}

Answer a question using only the emails supplied.

Rules:
- Use only what is in the emails. Never add a fact from anywhere else.
- Cite every claim with the email's number in square brackets: [2].
- Maximum 3 sentences.
- If the emails do not answer the question, say exactly: Not in this mail.
- Never say what the reader should do about it. Never offer to help further.
- Dates and amounts must be copied exactly as they appear, not restated.

Output format: the answer alone, with its citations. Nothing else.`;

/**
 * Screening a stranger.
 *
 * The only prompt in Pigeon whose output can silence somebody, which is why it
 * is written to say "unsure" rather than to be decisive, and why nothing it
 * returns is ever applied without the user pressing a button. The model
 * proposes a selection; the Screener's existing approve and decline actions,
 * with their existing eight seconds of undo, are what act.
 *
 * Same evidence-first ordering as the lane prompt, for the same reason.
 */
export const TRIAGE_SYSTEM = `${PIGEON_VOICE}

Recommend what to do with mail from a sender the reader has never written to.

The three answers:
- approve: a person is writing to this reader specifically, about something
  real, and would reasonably expect a reply.
- decline: bulk mail sent to a list, a cold sales pitch, or an attempt to
  extract money, credentials or attention under a false pretext.
- unsure: anything else, including anything you would have to guess at.

Rules:
- Prefer unsure. A wrong decline silences somebody permanently.
- A newsletter is unsure unless it was plainly never subscribed to: the reader
  may well have signed up for it.
- A recruiter writing personally is unsure. A recruiter mail-merging is decline.
- An invoice, receipt or security alert the reader did not expect is unsure,
  never decline — an unexpected bill is the most important mail of the week.
- Urgency, a deadline, or a threat of account closure is evidence of decline,
  not of importance.
- State the evidence first, in at most 8 words, then the answer.

Output format: one line per sender, exactly \`<number>: <evidence> — <answer>\`.
No preamble, no numbering of your own, no blank lines.`;

export interface TriageItem {
  n: number;
  from: string;
  subject: string;
  body: string;
}

export function triageUser(items: TriageItem[]): string {
  return items
    .map(
      (i) =>
        `${i.n}. from: ${i.from}\n   subject: ${i.subject}\n   ${i.body.replace(/\s+/g, ' ').slice(0, 400)}`,
    )
    .join('\n\n');
}

export interface AnswerSource {
  n: number;
  from: string;
  subject: string;
  date: string;
  body: string;
}

export function answerUser(question: string, sources: AnswerSource[]): string {
  const block = sources
    .map(
      (s) =>
        `[${s.n}] from ${s.from}, ${s.date}\nsubject: ${s.subject}\n${s.body.replace(/\n{3,}/g, '\n\n').slice(0, 1200)}`,
    )
    .join('\n\n---\n\n');
  return `Question: ${question}\n\nEmails:\n\n${block}`;
}

/**
 * Which sources the answer actually leaned on, in the order it cited them.
 * The UI lists these under the answer so every claim is one click from the
 * message it came from — the citation is the whole reason to trust this.
 */
export function citedSources(answer: string, max: number): number[] {
  const out: number[] = [];
  for (const match of answer.matchAll(/\[(\d+)\]/g)) {
    const n = Number(match[1]);
    if (n >= 1 && n <= max && !out.includes(n)) out.push(n);
  }
  return out;
}

/**
 * What the model meant, minus what it typed twice.
 *
 * Small models end an answer and then keep going: a paragraph of citations on
 * their own (`[2] [3]`), or the whole answer again underneath. Both were
 * visible in the first run of this prompt against llama3.2:3b, including on the
 * refusal — "Not in this mail." followed by two stray citations and then "Not
 * in this mail." again.
 *
 * Citation-only paragraphs are dropped from the *text* and not from the
 * answer: `citedSources` reads the whole completion, so a model that lists its
 * sources at the bottom still gets them shown, just not as a stray line of
 * brackets under a sentence.
 */
export function tidyAnswer(raw: string): string {
  const paragraphs = raw
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    // Nothing but citations and punctuation: the model's own footnote line.
    .filter((p) => p.replace(/\[\d+\]/g, '').replace(/[^\p{L}\p{N}]/gu, '').length > 0);

  const seen = new Set<string>();
  const kept: string[] = [];
  for (const p of paragraphs) {
    const key = p.toLowerCase().replace(/\[\d+\]/g, '').replace(/\s+/g, ' ').trim();
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push(p);
  }

  /*
   * §7.9's ceiling is a rule, not a suggestion to fill — and a model that
   * ignored it should not get to.
   *
   * Split on a full stop followed by a space and a capital, rather than on the
   * punctuation alone. "EUR 248.00" is one number, and the prompt specifically
   * tells the model to copy amounts exactly; a splitter that cuts inside them
   * turned a correct answer into "00 [3]".
   */
  const sentences = kept.join(' ').split(/(?<=[.!?])\s+(?=["'([]?\p{Lu})/u);
  return sentences.slice(0, 3).join(' ').trim();
}

/**
 * Removes a placeholder that asks for nothing.
 *
 * D26 blocks Send on any `[confirm:` in the body, which is right when the
 * placeholder names what is missing and useless when it does not: the helper
 * line reads "Replace [confirm:] before sending" and there is nothing to
 * replace it *with*. Measured against qwen2.5:32b, every tone control did this
 * to a draft that had no placeholder to begin with, so using one on a finished
 * reply made it unsendable.
 *
 * The prompt asks the model not to; this is what makes it true. A placeholder
 * that does name something is left exactly alone — that one is the feature.
 */
export function dropEmptyPlaceholders(body: string): string {
  return body
    .replace(/\s*\[confirm:\s*\]/gi, '')
    // "…by ." and "…by  ." are what removing a trailing one leaves behind.
    .replace(/\s+([.,;:!?])/g, '$1')
    .replace(/[^\S\n]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** True when the model said, in so many words, that it could not answer. */
export function isRefusal(answer: string): boolean {
  return /^\s*not in this mail\b/i.test(answer.trim());
}

export interface SortItem {
  /** Row number in the prompt, and the key the answer is matched back on. */
  n: number;
  from: string;
  subject: string;
  /** First line or two of the body. Enough to judge, cheap enough to batch. */
  preview: string;
}

export function sortUser(items: SortItem[]): string {
  return items
    .map(
      (i) =>
        `${i.n}. from: ${i.from}\n   subject: ${i.subject}\n   preview: ${i.preview.replace(/\s+/g, ' ').slice(0, 220)}`,
    )
    .join('\n\n');
}

export function draftSystem(styleSamples: string[] | undefined): string {
  const register = styleSamples?.length
    ? `Match the register, greeting style, sign-off, and typical length of the reader's own sent mail, samples of which follow the thread.`
    : `Use a neutral professional register.`;

  return `${UNIVERSAL}

Write a reply on the reader's behalf, in their voice: first person, as though
they typed it. ${register}

${DRAFT_RULES}`;
}

const TONE_RULES: Record<Tone, string> = {
  shorter: `Remove sentences; never compress into jargon. Target 60% of the
current length.`,
  friendlier: `Add a greeting and a closing courtesy, and soften imperatives to
requests. Do not add compliments or enthusiasm. Sign off the way the draft
already does, or not at all.`,
  firmer: `Remove hedges and apologies, and state the request as a direct ask
with a deadline if one is already in the draft. Do not add threats or escalation
language.`,
};

/**
 * §7.9's "keep every [confirm:] placeholder", written so it cannot be read as
 * an instruction to produce one.
 *
 * It could be, and was. Measured against qwen2.5:32b: a draft containing no
 * placeholder at all came back from all three tones carrying a bare
 * `[confirm:]` — "Sincerely,\n\n[confirm:]" from friendlier, "by [confirm:]."
 * from firmer. An empty placeholder is worse than a wrong one, because D26
 * blocks Send on any `[confirm:` and the helper line then asks the user to
 * replace something that never said what it wanted. Pressing a tone button on
 * a finished draft made it unsendable.
 */
const TONE_PLACEHOLDERS = `The draft may contain [confirm: …] placeholders.
Reproduce the ones that are there, character for character. Never write a new
one, and never write an empty [confirm:] — if a detail is missing, leave the
sentence as the draft has it.`;

export function toneSystem(tone: Tone): string {
  return `${UNIVERSAL}

Rewrite a draft reply, keeping it in the reader's own voice and first person.
${TONE_RULES[tone]}

${TONE_PLACEHOLDERS}

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

/**
 * Reads `3: promotions — offer with a deadline` out of whatever the model
 * actually returned, ignoring everything that isn't one of those lines.
 *
 * Deliberately forgiving about the separator and the reason: small models
 * substitute a hyphen for an em dash, drop the reason entirely, or wrap the
 * lane in asterisks. None of those are worth discarding an otherwise correct
 * answer over. An unrecognised lane name is worth discarding, because the only
 * alternative is filing the thread somewhere that does not exist.
 */
export function parseLaneLines(
  text: string,
  allowed: readonly string[],
): { n: number; lane: string; why: string }[] {
  const out: { n: number; lane: string; why: string }[] = [];
  const seen = new Set<number>();

  for (const raw of text.split('\n')) {
    const numbered = /^\s*\**(\d+)\**\s*[.:)-]\s*(.+?)\s*$/.exec(raw.trim());
    if (!numbered) continue;

    const n = Number(numbered[1]);
    // A model that answers row 3 twice gets its first answer taken. Later
    // lines in these completions are where the drift is.
    if (seen.has(n)) continue;

    const body = numbered[2];

    /*
     * Find the label anywhere on the line, and take the last one.
     *
     * Matching only the end was too strict — `decline (no subscription)` and
     * `decline (prize notification)` were dropped outright, losing two of
     * twelve senders in the first live run. Matching only the start was too
     * strict the other way. Last-wins also resolves the one genuinely
     * ambiguous shape correctly: in "unsure about the deadline — decline" the
     * answer is decline, and the word "unsure" is part of the evidence.
     */
    let lane: string | null = null;
    let at = -1;
    let width = 0;
    for (const match of body.matchAll(/\p{L}+/gu)) {
      const word = match[0].toLowerCase();
      if (!allowed.includes(word)) continue;
      lane = word;
      at = match.index ?? 0;
      width = match[0].length;
    }

    // An unrecognised answer is worth discarding, because the only
    // alternative is acting on a label that does not exist.
    if (!lane) continue;

    /*
     * Evidence is whatever the label was not. Before it, per the prompt; after
     * it for a model that led with the label, and for the parenthetical some
     * of them append instead.
     */
    // `*` is in the trim set because a model that bolds its answer leaves the
    // opening asterisks stranded on the evidence: "an invoice — **".
    const trimEdges = (v: string) =>
      v.replace(/^[\s—–:*()-]+/, '').replace(/[\s—–:*()-]+$/, '').trim();
    const before = trimEdges(body.slice(0, at));
    const after = trimEdges(body.slice(at + width));

    seen.add(n);
    out.push({ n, lane, why: (before || after).replace(/[.]$/, '').trim() });
  }

  return out;
}
