import type { ReactNode } from 'react';

const URL_PATTERN = /(https?:\/\/[^\s<>()]+)/g;

/**
 * §5.9 — held messages are plain text but "links open in a new tab". Splits
 * on bare URLs and turns them into anchors; everything else passes through
 * untouched. Line breaks are handled by `white-space: pre-wrap` on the
 * container, not here.
 */
export function linkifyBody(text: string): ReactNode[] {
  return text.split(URL_PATTERN).map((piece, i) =>
    i % 2 === 1 ? (
      <a key={i} href={piece} target="_blank" rel="noopener noreferrer">
        {piece}
      </a>
    ) : (
      piece
    ),
  );
}
