import type { Message } from '../../types';

/**
 * Which messages a thread opens collapsed, and where the reader starts reading.
 *
 * Separate from the component because this is the part that goes wrong, and
 * jsdom has no layout to test it through: every rect it reports is zero, so a
 * component test would pass against arithmetic that is backwards.
 */

/**
 * §5.6 — expanded by default except messages the user sent that already have a
 * later message after them, and any message beyond the 8 most recent.
 */
export function defaultCollapse(messages: Message[]): Set<string> {
  const n = messages.length;
  const collapsed = new Set<string>();
  messages.forEach((m, i) => {
    const hasLaterMessage = i < n - 1;
    const beyondRecent8 = i < n - 8;
    if ((m.isFromUser && hasLaterMessage) || beyondRecent8) collapsed.add(m.id);
  });
  return collapsed;
}

/** §5.6's collapsed message is "32px tall, one line". */
const COLLAPSED_ROW_HEIGHT = 32;

/**
 * The first message that isn't collapsed by default — where reading a thread
 * actually starts.
 *
 * A long thread opens on a wall of collapsed one-liners: at forty messages
 * §5.6's rule collapses the first thirty-four, which is 1,088px of history
 * above the first thing anyone opened the thread to read. The spec fixes which
 * messages collapse but says nothing about where the pane starts, because its
 * own example thread has four messages and the question never comes up.
 */
export function firstExpandedId(messages: Message[], collapsed: Set<string>): string | null {
  return messages.find((m) => !collapsed.has(m.id))?.id ?? null;
}

/**
 * How far to scroll the reader body so a thread opens where reading starts, or
 * null to leave it at the top.
 *
 * Separate and pure because this is the part that goes wrong, and jsdom has no
 * layout to test it through: every rect it reports is zero, so a component test
 * would pass against arithmetic that is backwards.
 */
export function readerStartOffset(
  targetTop: number,
  bodyTop: number,
  bodyHeight: number,
): number | null {
  const delta = targetTop - bodyTop;

  // Above the top only happens mid-scroll; the pane is already past it.
  if (delta <= 0) return null;

  // Comfortably in view already. A short thread keeps §5.6's summary block
  // where the spec puts it, at the top of the pane.
  if (delta < bodyHeight - 96) return null;

  // One collapsed row still showing, so the history above stays visible rather
  // than looking like the thread begins here.
  return delta - COLLAPSED_ROW_HEIGHT;
}
