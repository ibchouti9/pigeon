import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * An exported function or component that nothing references is not merely dead
 * weight — it is where a rule quietly stops agreeing with itself. Both times
 * this happened here, a screen had reimplemented the unused thing inline and
 * the two copies had drifted:
 *
 * - C-4 Badge went unused while the rail drew its own counts, and they
 *   disagreed about truncating a count above 99.
 * - `sendBlockedReason` sat in the compose store while the Composer computed
 *   the same thing from the same §7 strings, and they disagreed about an
 *   empty To.
 *
 * Neither was caught by typecheck, lint, or any test, because each half was
 * individually consistent. This is the sweep that found them, kept.
 *
 * Types and `*Props` interfaces are exempt: exporting the prop type beside its
 * component is idiomatic and carries no rule.
 */

const ROOT = 'src';

/** Values, not types — a type export can't drift from a duplicate. */
const EXPORT = /^export (?:async )?(?:function|const|class) (\w+)/gm;

/**
 * Symbols that are meant to have no reference outside their file. Each needs a
 * reason, not just an entry.
 */
const EXEMPT: Record<string, string> = {};

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(path));
    else if (/\.tsx?$/.test(entry.name) && !entry.name.endsWith('.d.ts')) out.push(path);
  }
  return out;
}

describe('every exported value is referenced somewhere', () => {
  const files = sourceFiles(ROOT);
  const sources = new Map(files.map((f) => [f, readFileSync(f, 'utf8')]));

  it('finds the source tree', () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it('has no export that only its own file mentions', () => {
    const orphans: string[] = [];

    for (const [file, source] of sources) {
      // A test file's exports are its cases; nothing imports them.
      if (file.includes('__tests__')) continue;

      for (const [, name] of source.matchAll(EXPORT)) {
        if (EXEMPT[name]) continue;

        const referenced = [...sources].some(
          ([other, text]) => other !== file && new RegExp(`\\b${name}\\b`).test(text),
        );
        if (!referenced) orphans.push(`${name} (${file})`);
      }
    }

    expect(orphans).toEqual([]);
  });

  it('keeps the exemption list honest — every entry is still exported somewhere', () => {
    for (const name of Object.keys(EXEMPT)) {
      const exported = [...sources.values()].some((text) =>
        new RegExp(`^export (?:async )?(?:function|const|class) ${name}\\b`, 'm').test(text),
      );
      expect(exported, `${name} is exempted but no longer exported`).toBe(true);
    }
  });
});
