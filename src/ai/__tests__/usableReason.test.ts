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
