import type { HeldSender } from '../../types';

/**
 * §5.7 acceptance check — card 2 and card 3's opposing insets, exactly.
 * "At any card height, both behind-card top edges must be visible above the
 * live card." CardStack applies these as inline styles (not just a CSS
 * class) so the geometry is trivially assertable in a test, per the task:
 * see `__tests__/CardStack.test.tsx`.
 */
export const BEHIND_INSETS: { left: number; right: number; top: number; bottom: number }[] = [
  { left: 32, right: 32, top: -12, bottom: 12 },
  { left: 44, right: 44, top: -24, bottom: 24 },
];

/**
 * Rotates `list` so the entry whose sender id is `topId` comes first,
 * preserving the relative order of everything else. This is how CardStack
 * models "cycle without deciding" (`j`/`k`): the underlying held list from
 * the store never reorders, only the on-screen rotation does.
 *
 * Falls back to the list as-is when `topId` is unset or no longer present
 * (e.g. the moment after its sender was decided and removed).
 */
export function rotateFrom(list: HeldSender[], topId: string | null): HeldSender[] {
  if (!topId) return list;
  const idx = list.findIndex((h) => h.sender.id === topId);
  if (idx <= 0) return list;
  return [...list.slice(idx), ...list.slice(0, idx)];
}
