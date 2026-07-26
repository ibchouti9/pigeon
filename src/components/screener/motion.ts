/**
 * JS-driven timing for the animations §4.6 describes declaratively in CSS
 * tokens. These mirror `--duration-stamp` / `--duration-base` and the
 * postmark's 260ms depart delay so the overlay cards in CardStack/BulkReview
 * unmount exactly when their CSS transition finishes — never sooner (which
 * would cut the animation off) or later (which would leave a dead card).
 *
 * `prefers-reduced-motion` shortens these the same way `base.css` shortens
 * the tokens, so the two stay in lockstep without reading computed styles.
 */

export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export const MOTION = {
  /** `--duration-stamp` — the postmark stamp itself. */
  stamp: (): number => (prefersReducedMotion() ? 100 : 420),
  /** `--duration-base` — row depart, card rise, cycle animation. */
  base: (): number => (prefersReducedMotion() ? 100 : 180),
  /** The fixed 260ms delay between stamp start and card depart start. */
  departDelay: (): number => (prefersReducedMotion() ? 0 : 260),
};
