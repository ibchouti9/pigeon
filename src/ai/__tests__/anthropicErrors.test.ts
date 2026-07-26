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
