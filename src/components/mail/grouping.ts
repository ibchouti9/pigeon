import { dateGroupLabel } from '../../lib/format';
import type { Thread } from '../../types';

export interface ThreadGroup {
  label: string;
  threads: Thread[];
}

/**
 * §5.5 — buckets an already date-sorted thread list without reordering it, so
 * the sticky group headers follow the list rather than imposing an order on it.
 */
export function groupThreadsByDate(
  threads: Thread[],
  opts: { archive?: boolean; now?: Date } = {},
): ThreadGroup[] {
  const groups: ThreadGroup[] = [];
  const index = new Map<string, ThreadGroup>();

  for (const thread of threads) {
    const label = dateGroupLabel(thread.lastMessageAt, opts);
    let group = index.get(label);
    if (!group) {
      group = { label, threads: [] };
      index.set(label, group);
      groups.push(group);
    }
    group.threads.push(thread);
  }

  return groups;
}
