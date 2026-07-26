import { describe, expect, it } from 'vitest';
import { CURATED_MODELS, getAiClient } from '../client';
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
