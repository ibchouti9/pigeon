import type { Digest, DigestCategory, HeldSender } from '../../types';

/** Display labels for the grouping chips (§5.7 digest block). */
export const CATEGORY_LABEL: Record<DigestCategory, string> = {
  junk: 'Junk',
  newsletters: 'Newsletters',
  recruiters: 'Recruiters',
  sales: 'Sales',
  support: 'Support',
  'client inquiry': 'Client inquiry',
  personal: 'Personal',
  unclear: 'Unclear',
  other: 'Other',
};

/**
 * Groups held senders by category for the chips row. Purely local — every
 * sender already carries its category, so this needs no AI call. The
 * sentence itself (`Digest['sentence']`) comes from the assistant via
 * `useScreenerDigest`.
 */
export function buildDigestGroups(held: HeldSender[]): Digest['groups'] {
  const order: DigestCategory[] = [];
  const bySenderIds = new Map<DigestCategory, string[]>();

  for (const h of held) {
    const category = h.category ?? 'unclear';
    const list = bySenderIds.get(category);
    if (list) {
      list.push(h.sender.id);
    } else {
      bySenderIds.set(category, [h.sender.id]);
      order.push(category);
    }
  }

  return order
    .map((category) => ({
      category,
      count: bySenderIds.get(category)!.length,
      senderIds: bySenderIds.get(category)!,
    }))
    .sort((a, b) => b.count - a.count);
}
