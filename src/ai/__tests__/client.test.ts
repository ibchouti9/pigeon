import { afterEach, describe, expect, it } from 'vitest';
import { CURATED_MODELS, getAiClient, isAiFailingForDev, setAiFailureForDev } from '../client';
import { DEFAULT_BASE_URL, hasProvider, type ProviderConfig } from '../../store/settings';

function config(patch: Partial<ProviderConfig> = {}): ProviderConfig {
  return { provider: 'none', apiKey: '', baseUrl: DEFAULT_BASE_URL, model: '', ...patch };
}

describe('getAiClient — C-28 gating', () => {
  it('returns null when no provider is chosen', () => {
    expect(getAiClient(config())).toBeNull();
  });

  it('returns null for a remote provider with no key', () => {
    expect(getAiClient(config({ provider: 'anthropic', model: 'claude-sonnet-5' }))).toBeNull();
  });

  it('returns null for a remote provider with no model', () => {
    expect(getAiClient(config({ provider: 'anthropic', apiKey: 'sk-ant-test' }))).toBeNull();
  });

  it('returns a client once a remote provider has both', () => {
    const client = getAiClient(
      config({ provider: 'anthropic', apiKey: 'sk-ant-test', model: 'claude-sonnet-5' }),
    );
    expect(client?.provider).toBe('anthropic');
  });

  it('needs a base URL and a model for the local provider, never a key (D47)', () => {
    expect(getAiClient(config({ provider: 'local', model: 'llama3' }))?.provider).toBe('local');
    expect(getAiClient(config({ provider: 'local', baseUrl: '', model: 'llama3' }))).toBeNull();
    expect(getAiClient(config({ provider: 'local' }))).toBeNull();
  });

  it('needs only a model for the demo provider', () => {
    expect(getAiClient(config({ provider: 'demo', model: 'demo' }))?.provider).toBe('demo');
  });
});

describe('hasProvider', () => {
  it('agrees with getAiClient on every provider', () => {
    const cases: ProviderConfig[] = [
      config(),
      config({ provider: 'anthropic' }),
      config({ provider: 'anthropic', apiKey: 'k', model: 'claude-sonnet-5' }),
      config({ provider: 'openai', apiKey: 'k', model: 'gpt-5.1' }),
      config({ provider: 'local', model: 'llama3' }),
      config({ provider: 'local' }),
      config({ provider: 'demo', model: 'demo' }),
    ];

    for (const c of cases) {
      expect(hasProvider(c)).toBe(getAiClient(c) !== null);
    }
  });
});

describe('CURATED_MODELS — D45', () => {
  it('offers a short curated list per remote provider, never free text', () => {
    expect(CURATED_MODELS.anthropic.length).toBeGreaterThan(0);
    expect(CURATED_MODELS.openai.length).toBeGreaterThan(0);
    expect(CURATED_MODELS.google.length).toBeGreaterThan(0);
    for (const provider of ['anthropic', 'openai', 'google'] as const) {
      expect(CURATED_MODELS[provider].length).toBeLessThanOrEqual(4);
    }
  });

  it('offers nothing for local until the endpoint reports its models (D47)', () => {
    expect(CURATED_MODELS.local).toEqual([]);
  });
});

/**
 * §8.5 item 1 wants every state reachable in the harness, and the AI failure
 * states were the last that weren't: `/dev/states` swaps the *mail* provider,
 * and no assistant anyone can run without a key ever fails.
 */
describe('the dev-only assistant failure switch', () => {
  afterEach(() => setAiFailureForDev(false));

  const demo = (): ProviderConfig => ({
    provider: 'demo',
    apiKey: '',
    baseUrl: DEFAULT_BASE_URL,
    model: 'demo',
  });

  it('is off unless it is turned on', () => {
    expect(isAiFailingForDev()).toBe(false);
  });

  it('makes every call reject once on', async () => {
    setAiFailureForDev(true);
    const client = getAiClient(demo());
    expect(client).not.toBeNull();

    await expect(client!.summarizeThread({ messages: [] } as never, 'a@b.c')).rejects.toThrow();
    await expect(client!.summarizeThread({ id: 't', subject: '', place: 'inbox', unread: false, messages: [], lastMessageAt: '' }, 'a@b.c')).rejects.toThrow();
    await expect(
      client!.draftReply({ messages: [], subject: '', recipients: [], userName: '' }),
    ).rejects.toThrow();
  });

  it('still returns null where C-28 says there is no client at all', () => {
    setAiFailureForDev(true);
    // A failing assistant is not the same as an unconnected one: D44's degraded
    // form has to stay reachable while the switch is on.
    expect(getAiClient({ ...demo(), provider: 'none' })).toBeNull();
  });

  it('goes back to the real client when turned off', async () => {
    setAiFailureForDev(true);
    setAiFailureForDev(false);
    const client = getAiClient(demo());
    await expect(client!.sortThreads([])).resolves.toEqual([]);
  });
});
