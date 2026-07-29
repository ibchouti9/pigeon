import { useEffect, useState } from 'react';
import { isTypingTarget } from '../store/ui';

/**
 * Whether a keyboard is up over the app.
 *
 * Focus, not geometry. The obvious test is to compare `visualViewport.height`
 * against `window.innerHeight` and call the difference the keyboard — and on
 * this webview that difference is always zero, because iOS resizes the whole
 * webview when the keys appear rather than covering it. Measured on the
 * simulator: keyboard up, both heights agree, and a hook written that way
 * reports nothing at exactly the moment it is needed.
 *
 * So ask the question the app can actually answer. A phone raises a keyboard
 * whenever a text field takes focus and lowers it when the field lets go, and
 * that is also the only thing the callers care about — whether the person is
 * typing right now.
 *
 * A hardware keyboard paired to the device raises no keys, but it does raise
 * the accessory bar, which sits over the bottom of the app in the same way and
 * for the same duration. Focus is the right signal there too.
 *
 * ---
 *
 * Still open, and worth knowing before the next attempt: opening a reply also
 * slides the whole shell upwards, putting the thread's header across the
 * status bar. That is iOS scrolling the document to reveal the focused field —
 * it will scroll the document even though the app is exactly one screen tall
 * and `html`/`body` are `height: 100%` with nothing to scroll.
 *
 * The obvious repair — `overflow: hidden` on html and body, plus a listener
 * that resets `scrollTop` on `scroll` and `focusin` — was built and reverted.
 * It does hold the shell still, verified on the simulator. But iOS's clumsy
 * scroll was the only thing bringing the compose fields out from behind the
 * keys, and taking it away left the field being typed into invisible. Calling
 * `scrollIntoView({ block: 'nearest' })` on the field did not stand in for it:
 * tried on `focusin`, again on the next frame, again on the window `resize`
 * that follows the webview shrinking, and reading the element from the event
 * rather than `document.activeElement` in case focus had moved on — the
 * reader's scroller did not move in any of them. So the cause is upstream of
 * the timing, in which element is scrollable at that moment, and that is where
 * to start. Sliding chrome beats an invisible cursor until then.
 */
/*
 * `Boolean(…)` because `isTypingTarget` ends its `||` chain on
 * `isContentEditable`, which jsdom does not implement — so under test it
 * returns `undefined` for everything that is not a field, and a hook that
 * passed that straight through would report neither open nor closed.
 */
const typing = () => Boolean(isTypingTarget(document.activeElement));

export function useKeyboardOpen(): boolean {
  const [open, setOpen] = useState(typing);

  useEffect(() => {
    const check = () => setOpen(typing());

    /*
     * `focusout` fires before focus lands anywhere else, so reading
     * `activeElement` inside it sees `<body>` even when the next field is
     * about to take over — moving between the To and Subject fields would
     * flicker the tab bar back in and out. Reading on the next frame lets the
     * new focus arrive first.
     */
    const later = () => requestAnimationFrame(check);

    document.addEventListener('focusin', check);
    document.addEventListener('focusout', later);
    return () => {
      document.removeEventListener('focusin', check);
      document.removeEventListener('focusout', later);
    };
  }, []);

  return open;
}
