import type { ReactNode } from 'react';

/*
 * A trailing `.` or `)` is almost always the sentence's, not the URL's —
 * `htmlToText` writes destinations as "text (https://…)", so the closing
 * bracket sits against the last character of every link it recovers.
 */
const URL_PATTERN = /(https?:\/\/[^\s<>()]*[^\s<>().,;:!?'"])/g;

/**
 * §5.9 — message bodies are plain text but "links open in a new tab". Splits
 * on bare URLs and turns them into anchors; everything else passes through
 * untouched. Line breaks are handled by `white-space: pre-wrap` on the
 * container, not here.
 *
 * Both readers use this. It lived under `screener/` and was wired only into
 * the held-message sheet, so the one place a URL was guaranteed to be
 * clickable was the screen for mail the user had not yet accepted.
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
