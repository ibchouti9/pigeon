import { useEffect } from 'react';

/**
 * Publishes how much of the screen the software keyboard is covering, as
 * `--keyboard-inset` on the root element.
 *
 * iOS shrinks the *visual* viewport when the keyboard opens and leaves the
 * layout viewport exactly as it was. Everything `position: fixed` is anchored
 * to the layout viewport, so a sheet pinned to `bottom: 0` stays pinned to a
 * bottom edge that is now behind the keyboard — which is where the composer's
 * Send button went, and the assistant's input, and the reply row. Each of them
 * is the control you were reaching for when you raised the keyboard in the
 * first place.
 *
 * There is a declarative fix for this (`interactive-widget` in the viewport
 * meta) and Safari does not implement it. `visualViewport` it is.
 *
 * `offsetTop` is subtracted because iOS also scrolls the visual viewport up
 * within the layout viewport to keep the focused field visible; without it the
 * inset is over-reported by however far it scrolled, and the sheet jumps
 * upward past the keyboard instead of resting on it.
 *
 * Inert everywhere else: a desktop browser has no software keyboard, so the
 * arithmetic yields zero and every `max(--safe-bottom, --keyboard-inset)`
 * downstream keeps its first argument.
 */
export function useKeyboardInset(): void {
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;

    const root = document.documentElement;

    function update() {
      if (!viewport) return;
      const covered = window.innerHeight - viewport.height - viewport.offsetTop;
      // Rounded, because a fractional pixel here re-triggers a style
      // recalculation on every frame of the keyboard's own animation.
      root.style.setProperty('--keyboard-inset', `${Math.round(Math.max(0, covered))}px`);
    }

    viewport.addEventListener('resize', update);
    viewport.addEventListener('scroll', update);
    update();

    return () => {
      viewport.removeEventListener('resize', update);
      viewport.removeEventListener('scroll', update);
      root.style.removeProperty('--keyboard-inset');
    };
  }, []);
}
