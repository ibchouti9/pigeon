import { afterEach, describe, expect, it, vi } from 'vitest';
import { anthropicAdapter } from '../adapters/anthropic';
import type { ProviderConfig } from '../../store/settings';

/**
 * What Test connection says for each way Anthropic can answer.
 *
 * The mapping used to fall through to "check your connection" for any status
 * it didn't recognise — so a 400 or 404, which can only arrive *after* auth
 * succeeded, told the user their network was down. Found the long way in the
 * packaged app: a working key "couldn't reach" Anthropic while a garbage key
 * was cleanly "rejected", and the difference between those two sentences sent
 * the debugging at the transport instead of the request.
 */

const CONFIG: ProviderConfig = {
  provider: 'anthropic',
  apiKey: 'sk-ant-test',
  baseUrl: '',
  model: 'claude-haiku-4-5',
};

/** Narrows the union: every case below expects a refusal. */
function refused(result: Awaited<ReturnType<typeof anthropicAdapter.test>>) {
  if (result.ok) throw new Error('expected the test to fail');
  return result;
}

function answer(status: number, body: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify(body), { status })),
  );
}

describe('Anthropic refusals, said accurately', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('a 401 is a rejected key', async () => {
    answer(401, { error: { type: 'authentication_error', message: 'invalid x-api-key' } });
    const result = refused(await anthropicAdapter.test(CONFIG));
    expect(result.message).toMatch(/rejected this key/);
  });

  it('an unrecognised refusal quotes the API rather than blaming the network', async () => {
    answer(404, {
      error: { type: 'not_found_error', message: 'model: claude-nonexistent' },
    });
    const result = refused(await anthropicAdapter.test(CONFIG));
    expect(result.message).toContain('model: claude-nonexistent');
    expect(result.message).not.toMatch(/connection/);
  });

  it('a refusal with no words at all is still not called a network problem twice', async () => {
    answer(418, {});
    const result = refused(await anthropicAdapter.test(CONFIG));
    // Nothing to quote, so the honest fallback stands.
    expect(result.message).toMatch(/Couldn't reach Anthropic/);
  });

  it('a request that never got an answer is the connection line', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Load failed');
      }),
    );
    const result = refused(await anthropicAdapter.test(CONFIG));
    expect(result.message).toMatch(/Couldn't reach Anthropic/);
  });
});

/**
 * The first real key found this: Test connection passed on Sonnet and failed
 * on Haiku with the same good key, and said the key was rejected. Both dials
 * below arrived after Haiku 4.5, so asking it for either is a 400 — and every
 * §7.6 status downstream is then describing the wrong thing.
 */
describe('Only the models with the dials are sent the dials', () => {
  afterEach(() => vi.unstubAllGlobals());

  async function bodyFor(model: string): Promise<Record<string, unknown>> {
    const fetchMock = vi.fn(
      async (_url: string, _init: RequestInit) =>
        new Response(JSON.stringify({ content: [{ type: 'text', text: 'OK' }] }), {
          status: 200,
        }),
    );
    vi.stubGlobal('fetch', fetchMock);
    await anthropicAdapter.test({ ...CONFIG, model });
    const [, init] = fetchMock.mock.calls[0]!;
    return JSON.parse(init.body as string);
  }

  it('leaves effort and thinking off a model that has neither', async () => {
    const body = await bodyFor('claude-haiku-4-5');
    expect(body).not.toHaveProperty('output_config');
    expect(body).not.toHaveProperty('thinking');
    // The request itself still has to be a request.
    expect(body.model).toBe('claude-haiku-4-5');
    expect(body.max_tokens).toBe(16);
  });

  it('still sends them to a model that has them', async () => {
    const body = await bodyFor('claude-sonnet-5');
    expect(body.output_config).toEqual({ effort: 'low' });
    expect(body.thinking).toEqual({ type: 'disabled' });
  });

  it('says nothing it has not been told about an unknown model', async () => {
    const body = await bodyFor('claude-something-later');
    expect(body).not.toHaveProperty('output_config');
  });
});
