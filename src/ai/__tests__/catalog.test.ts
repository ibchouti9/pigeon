import { describe, expect, it } from 'vitest';
import { buildCatalog, fitFor, uncuratedInstalled } from '../catalog';

describe('fitFor', () => {
  /*
   * Lifted from Buzz's `fit_thresholds_match_mesh_llm`, on purpose. Two apps
   * on the same Mac disagreeing about whether a 10GB model fits in 12GB would
   * be worse than either answer being slightly wrong.
   */
  it('matches the thresholds Buzz uses', () => {
    expect(fitFor(10, 20)).toBe('comfortable');
    expect(fitFor(10, 12)).toBe('tight');
    expect(fitFor(10, 10)).toBe('tradeoff');
    expect(fitFor(10, 8)).toBe('too-large');
  });

  it('calls everything comfortable when memory is unknown', () => {
    // Better than marking every model "too large" on a build that cannot
    // survey the machine.
    expect(fitFor(43, 0)).toBe('comfortable');
  });
});

describe('buildCatalog', () => {
  it('recommends the tier pick for a 16GB Mac, not merely the biggest that fits', () => {
    // Two thirds of 16GB is ~10.6GB usable. `llama3.1:8b` is larger than
    // `qwen2.5:7b` and also fits; the 7B is the better instruction-follower,
    // and instruction-following is the whole job.
    const c = buildCatalog(10.6, []);
    expect(c.recommended).toBe('qwen2.5:7b');
  });

  it('scales the recommendation with the machine', () => {
    expect(buildCatalog(5, []).recommended).toBe('llama3.2:3b');
    expect(buildCatalog(24, []).recommended).toBe('qwen2.5:14b');
    expect(buildCatalog(43, []).recommended).toBe('gemma3:27b');
  });

  it('never recommends a model that merely loads', () => {
    // 9GB in 10.6GB usable is a "tight" fit — it runs, and then swaps on every
    // one of the short calls Pigeon makes.
    const c = buildCatalog(10.6, []);
    const rec = c.entries.find((e) => e.recommended);
    expect(rec?.fit).toBe('comfortable');
  });

  it('puts the recommendation first and the safe pick second', () => {
    const c = buildCatalog(24, []);
    expect(c.entries[0].recommended).toBe(true);
    expect(c.entries[0].curated).toBe(true);
    expect(c.entries[1].name).toBe('llama3.2:3b');
    expect(c.entries[1].curated).toBe(true);
    expect(c.entries.slice(2).every((e) => !e.curated)).toBe(true);
  });

  it('ranks the rest by fit, then by size', () => {
    const c = buildCatalog(10.6, []);
    const rest = c.entries.filter((e) => !e.curated);
    const ranks = rest.map((e) => ['comfortable', 'tight', 'tradeoff', 'too-large'].indexOf(e.fit));
    expect(ranks.every((r, i) => i === 0 || ranks[i - 1] <= r)).toBe(true);
  });

  it('lists models too large for the machine rather than hiding them', () => {
    const c = buildCatalog(6, []);
    expect(c.entries.some((e) => e.fit === 'too-large')).toBe(true);
    expect(c.entries).toHaveLength(10);
  });

  it('marks what Ollama already has', () => {
    const c = buildCatalog(10.6, ['qwen2.5:7b', 'llama3.2:3b']);
    expect(c.entries.find((e) => e.name === 'qwen2.5:7b')?.installed).toBe(true);
    expect(c.entries.find((e) => e.name === 'gemma3:12b')?.installed).toBe(false);
  });

  it('matches an installed model through :latest and a quant suffix', () => {
    const c = buildCatalog(10.6, ['llama3.2:3b-instruct-q4_K_M', 'gemma3:4b:latest']);
    expect(c.entries.find((e) => e.name === 'llama3.2:3b')?.installed).toBe(true);
    expect(c.entries.find((e) => e.name === 'gemma3:4b')?.installed).toBe(true);
  });

  it('prefers something already pulled when the machine is unknown', () => {
    // The web build cannot survey memory. Recommending a 43GB download to
    // someone who already has a working model would be worse than useless.
    expect(buildCatalog(0, ['qwen2.5:7b']).recommended).toBe('qwen2.5:7b');
    expect(buildCatalog(0, []).recommended).toBe('llama3.2:3b');
  });

  it('carries the chip through when there is one', () => {
    expect(buildCatalog(10.6, [], 'Apple M3').chip).toBe('Apple M3');
    expect(buildCatalog(10.6, []).chip).toBeUndefined();
  });
});

describe('uncuratedInstalled', () => {
  it('keeps a model the user chose that Pigeon does not list', () => {
    expect(uncuratedInstalled(['qwen2.5:7b', 'phi4:14b'])).toEqual(['phi4:14b']);
  });

  it('does not report a curated model as unknown', () => {
    expect(uncuratedInstalled(['llama3.2:3b', 'gemma3:12b'])).toEqual([]);
  });

  it('recognises a curated model wearing a quant suffix', () => {
    expect(uncuratedInstalled(['qwen2.5:7b-instruct-q5_K_M'])).toEqual([]);
  });
});
