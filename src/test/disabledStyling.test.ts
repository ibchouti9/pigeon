import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * §5.4 and §5.6 disable the offline controls with `aria-disabled="true"` rather
 * than the `disabled` attribute, so they keep their tab stop. CSS written
 * against `:disabled` alone doesn't match those, and the whole offline surface
 * rendered as fully live — same colour, same hover, pointer cursor, and a click
 * that did nothing. Any `:disabled` rule needs an `[aria-disabled='true']` twin.
 */
const STYLE_ROOT = 'src/components';

function styleSheets(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...styleSheets(path));
    else if (entry.name.endsWith('.module.css')) out.push(path);
  }
  return out;
}

/** Strips comments so a `:disabled` mentioned in prose isn't treated as a rule. */
function withoutComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

describe('disabled styling covers aria-disabled', () => {
  const sheets = styleSheets(STYLE_ROOT);

  it('finds stylesheets to check', () => {
    expect(sheets.length).toBeGreaterThan(10);
  });

  it.each(sheets)('%s pairs every :disabled selector with aria-disabled', (sheet) => {
    const css = withoutComments(readFileSync(sheet, 'utf8'));

    // Selectors are everything before the first `{` of each rule.
    const selectors = css.match(/[^{}]+(?=\{)/g) ?? [];
    const unpaired: string[] = [];

    for (const block of selectors) {
      for (const selector of block.split(',')) {
        const trimmed = selector.trim();
        // `:not(:disabled)` is an exclusion, handled by its own aria twin below.
        if (!trimmed.includes(':disabled')) continue;
        if (trimmed.includes(':not(:disabled)')) {
          if (!trimmed.includes('[aria-disabled="true"]')) unpaired.push(trimmed);
          continue;
        }
        const twin = trimmed.replace(/:disabled/g, "[aria-disabled='true']");
        if (!block.split(',').some((s) => s.trim() === twin)) unpaired.push(trimmed);
      }
    }

    expect(unpaired).toEqual([]);
  });
});
