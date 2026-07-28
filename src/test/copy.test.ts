import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * §7 voice rules and §8.5 item 7, enforced across the source rather than by
 * review. Every one of these has slipped into a real product at some point:
 * an apology in an error, an exclamation mark in a success toast, a "please"
 * in a button.
 */

const SRC = join(process.cwd(), 'src');

/**
 * The demo mail account is fictional correspondence written by fictional
 * people. §7 governs Pigeon's own voice, not the mail it carries — a recruiter
 * who writes "Just floating this back to the top of your inbox" is exactly
 * right, and sanding that down would make the demo read like nobody wrote it.
 */
const NOT_PRODUCT_COPY = [
  /data[/\\]mock[/\\]seed\.ts$/,
  /ai[/\\]adapters[/\\]demo\.ts$/,
  /*
   * A CSP header and the stylesheet for the reader's iframe. Every string in
   * it is machine-readable and none of it is ever shown to anyone — and the
   * `!important` it needs is not an exclamation mark but the only declaration
   * that outranks the inline styles an arbitrary HTML email arrives with.
   */
  /data[/\\]sanitize\.ts$/,
];

const ALLOWED = [
  // A timestamp idiom, not the filler word.
  /\bjust now\b/i,
  // §7.4's Screener empty state, verbatim — the spec's own copy uses "just".
  /they just don't interrupt you/i,
];

const BANNED: { pattern: RegExp; rule: string }[] = [
  { pattern: /\bsorry\b/i, rule: 'no "sorry" (§7)' },
  { pattern: /\boops\b/i, rule: 'no "oops" (§7)' },
  { pattern: /something went wrong/i, rule: 'no "something went wrong" (§8.5.7)' },
  { pattern: /\bplease\b/i, rule: 'no "please" (§7)' },
  { pattern: /\bsimply\b/i, rule: 'no "simply" (§7)' },
  { pattern: /\bjust\b/i, rule: 'no filler "just" (§7)' },
  { pattern: /!/, rule: 'no exclamation marks (§7)' },
];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      if (entry === '__tests__' || entry === 'test') continue;
      walk(path, out);
    } else if (/\.tsx?$/.test(entry)) {
      out.push(path);
    }
  }
  return out;
}

/** Strips comments so a note to a maintainer isn't mistaken for product copy. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

/**
 * Pulls out the strings a user could actually read: quoted literals and JSX
 * text nodes. Deliberately approximate — it over-collects rather than under-,
 * because a missed string is a missed violation.
 */
function userFacingStrings(source: string): string[] {
  const code = stripComments(source);
  const found: string[] = [];

  // A quote preceded by a letter is an apostrophe ("don't"), not a delimiter —
  // without this, `You'll … they just don't` is read as a string literal.
  for (const match of code.matchAll(/(?<![A-Za-z])'((?:[^'\\\n]|\\.)*)'/g)) found.push(match[1]);
  for (const match of code.matchAll(/"((?:[^"\\\n]|\\.)*)"/g)) found.push(match[1]);
  for (const match of code.matchAll(/`((?:[^`\\]|\\.)*)`/g)) found.push(match[1]);
  // JSX text between tags, e.g. `>Reply to {name}<`. Confined to a single line
  // and to characters that can't appear in an expression, so a `>` used as a
  // comparison operator doesn't drag half a function body in as "copy".
  for (const match of code.matchAll(/>([^<>{}();=\n]*[A-Za-z][^<>{}();=\n]*)</g)) {
    found.push(match[1]);
  }

  return found
    .map((s) => s.trim())
    .filter(Boolean)
    // Anything without a space is an identifier, a class name or a token.
    .filter((s) => /\s/.test(s))
    // Import paths, selectors and URLs are not product copy.
    .filter((s) => !/^https?:\/\//.test(s));
}

describe('interface copy (§7)', () => {
  const files = walk(SRC).filter((f) => !NOT_PRODUCT_COPY.some((skip) => skip.test(f)));

  it('scans a meaningful number of source files', () => {
    expect(files.length).toBeGreaterThan(30);
  });

  it.each(BANNED)('follows: $rule', ({ pattern, rule }) => {
    const violations: string[] = [];

    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      for (const text of userFacingStrings(source)) {
        if (!pattern.test(text)) continue;
        if (ALLOWED.some((allow) => allow.test(text))) continue;
        violations.push(`${file.replace(SRC, 'src')}: ${JSON.stringify(text)}`);
      }
    }

    expect(violations, `${rule}\n${violations.join('\n')}`).toEqual([]);
  });
});
