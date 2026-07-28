import { afterAll, describe, expect, it } from 'vitest';
import { getAiClient } from '../client';
import type { ProviderConfig } from '../../store/settings';
import { useSettings } from '../../store/settings';

/**
 * `usableReason` is not exported — it is an implementation detail of the two
 * passes that need it — so this drives it the way the app does: through a fake
 * local endpoint that returns a known completion, checking what survives into
 * the answer.
 *
 * Every completion below is a shape llama3.2:3b actually produced. The recurring
 * failure is the same one: asked for evidence, a small model hands back the
 * thing the user is already looking at.
 */
const CONFIG: ProviderConfig = {
  provider: 'local',
  apiKey: '',
  baseUrl: 'http://localhost:65535',
  model: 'test',
};

function respond(content: string) {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ message: { content } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })) as typeof fetch;
}

async function reasonFor(completion: string, subject: string): Promise<string> {
  respond(completion);
  const client = getAiClient(CONFIG);
  const [answer] = await client!.sortThreads([
    { threadId: 't1', from: 'Kavelle <marketing@kavelle.com>', subject, preview: '' },
  ]);
  return answer?.why ?? '<no answer>';
}

describe('the reason a sorting pass is allowed to show', () => {
  const originalFetch = globalThis.fetch;
  const originalSettings = useSettings.getState();

  afterAll(() => {
    globalThis.fetch = originalFetch;
    useSettings.setState(originalSettings);
  });

  it('keeps a real piece of evidence', async () => {
    expect(await reasonFor('1: sent to a list with an offer — promotions', 'New in Kavelle')).toBe(
      'sent to a list with an offer',
    );
  });

  it('drops the sender address echoed back', async () => {
    expect(await reasonFor('1: from: marketing@kavelle.com — promotions', 'New in Kavelle')).toBe('');
  });

  it('drops the subject line echoed back', async () => {
    expect(await reasonFor('1: New in Kavelle — promotions', 'New in Kavelle')).toBe('');
  });

  it('drops the subject reworded just enough to beat a substring test', async () => {
    // The exact miss: "Intro to the Atlas team" reappeared as "Introduction to
    // Atlas team" and printed under the subject it came from.
    expect(await reasonFor('1: Introduction to Atlas team — promotions', 'Intro to the Atlas team')).toBe(
      '',
    );
  });

  it('keeps a reason that merely shares a word with the subject', async () => {
    expect(
      await reasonFor('1: an unsolicited pitch from a vendor — promotions', 'Kavelle pitch deck'),
    ).toBe('an unsolicited pitch from a vendor');
  });

  it('drops a reason too short to say anything', async () => {
    expect(await reasonFor('1: ad — promotions', 'New in Kavelle')).toBe('');
  });

  it('still returns the lane when the reason was thrown away', async () => {
    respond('1: New in Kavelle — promotions');
    const client = getAiClient(CONFIG);
    const [answer] = await client!.sortThreads([
      { threadId: 't1', from: 'Kavelle <marketing@kavelle.com>', subject: 'New in Kavelle', preview: '' },
    ]);
    expect(answer.lane).toBe('promotions');
  });
});

/**
 * §7.9 caps the Screener read at 18 words. Nothing enforced it while the
 * prompt asked for an 8-word fragment; asking for a sentence — which is what
 * the card actually shows — made the ceiling reachable.
 */
describe('the §7.9 word ceiling', () => {
  const originalFetch = globalThis.fetch;
  const originalSettings = useSettings.getState();

  afterAll(() => {
    globalThis.fetch = originalFetch;
    useSettings.setState(originalSettings);
  });

  it('keeps a sentence that fits', async () => {
    const why = 'a warm intro from someone the reader emails often';
    expect(await reasonFor(`1: ${why} — people`, 'Intro')).toBe(why);
  });

  it('cuts one that does not, rather than overflowing the card', async () => {
    const long = Array.from({ length: 25 }, (_, i) => `word${i}`).join(' ');
    const out = await reasonFor(`1: ${long} — people`, 'Intro');
    // Eighteen words, and the ellipsis rides on the last of them.
    expect(out.split(/\s+/)).toHaveLength(18);
    expect(out.endsWith('…')).toBe(true);
  });
});

/**
 * The ledger reads a batch of conversations in one request, and a model that
 * loses track of which row it is on carries a detail from one onto another.
 * Measured against qwen2.5:32b: "decide the liability cap" — real, and
 * correctly found in Dana's contract thread — was also attached to a thread
 * about a different clause that never mentions a cap.
 *
 * A missed obligation costs the user nothing they did not already have. An
 * invented one is a lie about a person, and one they may act on.
 */
describe('an obligation has to be supported by its own conversation', () => {
  const originalFetch = globalThis.fetch;
  const originalSettings = useSettings.getState();

  afterAll(() => {
    globalThis.fetch = originalFetch;
    useSettings.setState(originalSettings);
  });

  async function ledgerFor(completion: string, transcript: string) {
    respond(completion);
    const client = getAiClient(CONFIG);
    return client!.extractObligations([
      {
        threadId: 't1',
        counterparty: 'Lena Fischer',
        subject: 'Question about clause 7',
        transcript,
        readerSpokeLast: false,
        ageDays: 1,
      },
    ]);
  }

  it('keeps one the conversation actually supports', async () => {
    const found = await ledgerFor(
      '1: decide the liability cap — needs-you — Friday',
      'them: any movement on the liability cap? I need an answer before Friday.',
    );
    expect(found).toHaveLength(1);
    expect(found[0].what).toBe('decide the liability cap');
  });

  it('drops one carried over from another conversation in the batch', async () => {
    const found = await ledgerFor(
      '1: decide the liability cap — needs-you — Friday',
      'them: clause 7 says the tooling stays with us. Is that still your reading?',
    );
    expect(found).toEqual([]);
  });

  it('survives the wording drifting between mail and obligation', async () => {
    const found = await ledgerFor(
      '1: send the phase two scoping notes — needs-you — no date',
      'them: could you send over the scope for phase two when you get a moment?',
    );
    expect(found).toHaveLength(1);
  });

  it('keeps a vague one rather than second-guessing it', async () => {
    // Nothing distinctive to check. Vague is not the same as invented, and the
    // thread is one click away.
    const found = await ledgerFor('1: reply to them — needs-you — no date', 'them: thoughts?');
    expect(found).toHaveLength(1);
  });
});
