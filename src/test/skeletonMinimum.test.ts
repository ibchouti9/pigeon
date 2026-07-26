import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * C-21 — a skeleton is "rendered for a minimum of 200ms once shown, to avoid a
 * flash". `useMinimumVisible` implements that, and it was applied one screen at
 * a time: the Screener card, the reader, the held sheet and O4 all still
 * rendered straight off their status flag, so a provider that answered in 40ms
 * produced a 40ms flicker that reads as a glitch rather than as loading.
 *
 * The rule is mechanical, so this checks it mechanically: a component that
 * shows a skeleton for a `loading` status routes that status through the hook.
 */

const ROOTS = ['src/components', 'src/routes'];

/**
 * Places where a skeleton is not driven by a load status, so the minimum has
 * nothing to protect against. Each needs a reason, not just an entry.
 */
const EXEMPT: Record<string, string> = {
  'primitives/Feedback.tsx': 'defines the skeletons; shows none of its own',
  'primitives/AiBlock.tsx':
    'an AI call takes seconds, never the sub-200ms that would flash',
  'mail/MessageBlock.tsx':
    'a message inside a reader whose own status already holds the minimum',
  'onboarding/CardStackMini.tsx': 'a static illustration, not a load state',
};

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__') continue;
      out.push(...sourceFiles(path));
    } else if (entry.name.endsWith('.tsx')) {
      out.push(path);
    }
  }
  return out;
}

describe('every skeleton honours C-21’s 200ms minimum', () => {
  const files = ROOTS.flatMap(sourceFiles);

  it('finds components to check', () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it('routes every skeleton through useMinimumVisible, or names why not', () => {
    const offenders: string[] = [];

    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      // Anything that renders one, however its branch is written. An earlier
      // version of this looked for a 'loading' status and so missed the
      // Screener card, which branches on `status !== 'ready'`.
      if (!/<Skeleton(Rows|Bar|Circle)\b/.test(source)) continue;
      if (Object.keys(EXEMPT).some((suffix) => file.endsWith(suffix))) continue;

      // The call, not the word: a mention in a comment is not a guarantee.
      if (!/useMinimumVisible\s*\(/.test(source)) offenders.push(file);
    }

    expect(offenders).toEqual([]);
  });

  it('keeps the exemption list honest — every entry still exists', () => {
    for (const suffix of Object.keys(EXEMPT)) {
      expect(
        files.some((f) => f.endsWith(suffix)),
        `${suffix} is exempted but no longer exists`,
      ).toBe(true);
    }
  });
});
