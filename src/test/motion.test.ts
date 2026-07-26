import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * §8.5 item 5 — under `prefers-reduced-motion: reduce`, no element moves.
 *
 * The global rule in tokens.css constrains `transition-property` to opacity and
 * colours, which covers every transition. It does **not** cover keyframes: an
 * `@keyframes` block that animates `transform` still travels. Any stylesheet
 * that animates a transform therefore has to ship its own fade-only fallback,
 * and this test is what stops the next one from forgetting.
 */

const SRC = join(process.cwd(), 'src');

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (entry.endsWith('.css')) out.push(path);
  }
  return out;
}

describe('reduced motion (§8.5 item 5)', () => {
  const sheets = walk(SRC).map((path) => ({ path, css: readFileSync(path, 'utf8') }));

  it('finds the stylesheets', () => {
    expect(sheets.length).toBeGreaterThan(10);
  });

  it('keeps the global transition constraint in the token block', () => {
    const tokens = sheets.find((s) => s.path.endsWith('tokens.css'));
    expect(tokens?.css).toMatch(/@media \(prefers-reduced-motion: reduce\)/);
    expect(tokens?.css).toMatch(/transition-property:\s*opacity, background-color, border-color, color\s*!important/);
  });

  it('gives every transform keyframe a reduced-motion fallback', () => {
    const missing = sheets
      .filter(({ css }) => {
        // Only keyframe bodies matter — a static transform doesn't animate.
        const keyframeBlocks = css.match(/@keyframes[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g) ?? [];
        const animatesTransform = keyframeBlocks.some((block) => /transform:/.test(block));
        return animatesTransform && !/prefers-reduced-motion/.test(css);
      })
      .map(({ path }) => path.replace(SRC, 'src'));

    expect(missing, `these animate a transform with no reduced-motion fallback:\n${missing.join('\n')}`).toEqual([]);
  });
});
