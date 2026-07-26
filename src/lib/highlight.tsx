import type { ReactNode } from 'react';

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Wraps every occurrence of `query`'s terms in a mark. §5.11: a quiet tint on
 * the matched run, no bold and no underline.
 */
export function highlightTerms(text: string, query: string, className: string): ReactNode {
  const terms = query
    .trim()
    .split(/\s+/)
    .filter((t) => t.length >= 2)
    .map(escapeRegExp);

  if (terms.length === 0) return text;

  const pattern = new RegExp(`(${terms.join('|')})`, 'gi');
  const parts = text.split(pattern);

  return parts.map((part, i) =>
    // split() with one capture group puts the matches at every odd index.
    i % 2 === 1 ? (
      <mark key={i} className={className}>
        {part}
      </mark>
    ) : (
      part
    ),
  );
}
