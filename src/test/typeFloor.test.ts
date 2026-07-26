import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * §8.5 item 10 — no text in the product renders below 11px, and no message body
 * below 15px.
 *
 * This was "verified" once by measuring the running app, on a screen that
 * happened to have no date group headers. Six of them were rendering at 10px.
 * A static check over the type scale catches what a spot measurement misses.
 */

const SRC = join(process.cwd(), 'src');

/** Every step of the scale that renders below the floor. */
const BELOW_FLOOR = ['t-mono-xs'];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      // Skip test directories — this file names the banned utility itself.
      if (entry === '__tests__' || entry === 'test') continue;
      walk(path, out);
    } else if (/\.tsx?$/.test(entry)) {
      out.push(path);
    }
  }
  return out;
}

describe('type floor (§8.5 item 10)', () => {
  const files = walk(SRC);

  it('reads the token scale and confirms which steps are below 11px', () => {
    const tokens = readFileSync(join(SRC, 'styles', 'tokens.css'), 'utf8');
    const sizes = Object.fromEntries(
      [...tokens.matchAll(/--(\w[\w-]*)-size:\s*(\d+)px/g)].map((m) => [m[1], Number(m[2])]),
    );

    expect(sizes['mono-xs']).toBe(10);
    // Everything the components actually use has to clear the floor.
    expect(sizes['mono-sm']).toBeGreaterThanOrEqual(11);
    expect(sizes['text-2xs']).toBeGreaterThanOrEqual(11);
    // §8.5 item 10's second clause: no message body below 15px.
    expect(sizes['text-md']).toBeGreaterThanOrEqual(15);
  });

  it.each(BELOW_FLOOR)('does not use %s in the DOM', (utility) => {
    const offenders = files
      .filter((file) => new RegExp(`['"\`]${utility}['"\`\\s]`).test(readFileSync(file, 'utf8')))
      .map((file) => file.replace(SRC, 'src'));

    expect(
      offenders,
      `${utility} renders below 11px:\n${offenders.join('\n')}`,
    ).toEqual([]);
  });
});
