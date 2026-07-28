/**
 * A live run of every AI surface against a real model.
 *
 * Not part of `npm test` — the filename ends `.probe.ts` so vitest's default
 * `*.test.*` glob never picks it up. It exists because the prompts in
 * `prompts.ts` were tuned against `llama3.2:3b` and the comments in that file
 * are full of findings from live runs; nothing has ever checked them against a
 * larger model, and nothing has ever looked at the *quality* of what comes
 * back rather than whether it parses.
 *
 *   npx vitest run --config vitest.probe.config.ts
 */
import { appendFileSync, existsSync, rmSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { getAiClient } from '../client';
import { buildInboxThreads, buildHeldMessages, DEMO_ACCOUNT } from '../../data/mock/seed';
import type { AiClient } from '../types';

const MODEL = process.env.PROBE_MODEL ?? 'qwen2.5:32b';
const BASE = process.env.PROBE_BASE ?? 'http://localhost:11434';
const TIMEOUT = 240_000;

function client(): AiClient {
  return getAiClient({ provider: 'local', apiKey: '', baseUrl: BASE, model: MODEL })!;
}

/*
 * Written to a file rather than logged. Vitest intercepts console output and
 * the transcript is the entire point of this file — the assertions only check
 * that the model answered at all.
 */
const OUT = process.env.PROBE_OUT ?? 'probe-transcript.txt';
if (existsSync(OUT)) rmSync(OUT);

function log(title: string, value: unknown) {
  const body = typeof value === 'string' ? value : JSON.stringify(value, null, 1);
  appendFileSync(OUT, `\n── ${title} ${'─'.repeat(Math.max(0, 60 - title.length))}\n${body}\n`);
}

describe('live model', () => {
  const threads = buildInboxThreads();
  const held = buildHeldMessages();

  it(
    'summarizes threads',
    async () => {
      const ai = client();
      for (const thread of threads.slice(0, 4)) {
        const started = Date.now();
        const bullets = await ai.summarizeThread(thread, DEMO_ACCOUNT.email);
        log(`SUMMARY (${Date.now() - started}ms) — ${thread.subject}`, bullets);
        expect(Array.isArray(bullets)).toBe(true);
      }
    },
    TIMEOUT,
  );

  it(
    'sorts lanes',
    async () => {
      const ai = client();
      const items = threads.slice(0, 8).map((t) => ({
        threadId: t.id,
        from: t.messages[0].from.name || t.messages[0].from.email,
        subject: t.subject,
        preview: t.messages[0].body.slice(0, 200),
      }));
      const started = Date.now();
      const answers = await ai.sortThreads(items);
      log(
        `LANES (${Date.now() - started}ms)`,
        answers.map((a) => {
          const item = items.find((i) => i.threadId === a.threadId);
          return `${item?.subject.slice(0, 42)} -> ${a.lane}  (${a.why})`;
        }),
      );
      expect(answers.length).toBeGreaterThan(0);
    },
    TIMEOUT,
  );

  it(
    'triages the screener',
    async () => {
      const ai = client();
      const items = held.slice(0, 8).map((h) => ({
        senderId: h.sender.id,
        from: `${h.sender.name} <${h.sender.email}>`,
        subject: h.messages[0].subject,
        body: h.messages[0].body,
      }));
      const started = Date.now();
      const answers = await ai.triageSenders(items);
      log(
        `TRIAGE (${Date.now() - started}ms)`,
        answers.map((a) => {
          const item = items.find((i) => i.senderId === a.senderId);
          return `${item?.from.slice(0, 38)} -> ${a.suggestion}  (${a.why})`;
        }),
      );
      expect(answers.length).toBeGreaterThan(0);
    },
    TIMEOUT,
  );

  it(
    'answers a question from the mail',
    async () => {
      const ai = client();
      const sources = threads.slice(0, 6).map((t) => ({
        threadId: t.id,
        from: t.messages[0].from.name || t.messages[0].from.email,
        subject: t.subject,
        date: t.lastMessageAt,
        body: t.messages.map((m) => m.body).join('\n\n'),
      }));

      for (const question of [
        'How much did I pay Atlasgrid?',
        'What did Dana ask me to decide, and by when?',
        'When is my train to Gothenburg?',
        'What is the capital of Peru?',
      ]) {
        const started = Date.now();
        const result = await ai.answer(question, sources);
        log(`ANSWER (${Date.now() - started}ms) — ${question}`, result);
      }
    },
    TIMEOUT,
  );

  it(
    'drafts a reply and retones it',
    async () => {
      const ai = client();
      const thread = threads.find((t) => t.subject.includes('Contract redlines')) ?? threads[0];
      const started = Date.now();
      const draft = await ai.draftReply({
        messages: thread.messages,
        subject: thread.subject,
        recipients: [thread.messages[0].from.email],
        userName: DEMO_ACCOUNT.name,
      });
      log(`DRAFT (${Date.now() - started}ms)`, draft);

      for (const tone of ['shorter', 'friendlier', 'firmer'] as const) {
        const t0 = Date.now();
        log(`RETONE ${tone} (${Date.now() - t0}ms)`, await ai.retone(draft, tone));
      }
    },
    TIMEOUT,
  );
});
