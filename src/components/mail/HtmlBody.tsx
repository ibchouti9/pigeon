import { useEffect, useMemo, useRef, useState } from 'react';
import { readerDocument, sanitizeBody } from '../../data/sanitize';
import { Button } from '../primitives/Button';
import { cn } from '../../lib/cn';
import styles from './HtmlBody.module.css';

/**
 * C-8's `body` prop — "sanitized HTML" — finally rendered as such.
 *
 * Bodies were flattened to text everywhere, which made HTML mail readable in
 * the sense that the words were present and unreadable in every other sense:
 * a receipt lost its table, a newsletter lost its structure, and C-8's whole
 * blocked-images state was unreachable because no image was ever requested.
 *
 * ## Why an iframe rather than a div
 *
 * A message is markup from someone the Screener has not approved yet. Put it
 * in this document and it inherits this document's origin, this document's
 * storage, and this document's layout — `position: fixed` in a marketing
 * email is enough to cover the app's own controls. The iframe is a hard
 * boundary for all three.
 *
 * ## Why `allow-same-origin` is safe here
 *
 * `sandbox` omits `allow-scripts`, and that is what makes the rest of it
 * sound: with scripting disabled there is no code inside the frame to make
 * use of the origin the flag grants. What the flag buys is the ability for
 * *this* side to read `contentDocument` and size the frame to its content —
 * the alternative is a fixed height with an inner scrollbar on every message.
 *
 * Adding `allow-scripts` later would undo this reasoning. It should not be
 * added.
 */
export interface HtmlBodyProps {
  html: string;
  /**
   * C-8: images load normally for established senders and are held back for
   * one approved less than 24 hours ago.
   */
  allowImages: boolean;
  /** Falls back to this when the HTML sanitizes down to nothing. */
  fallbackText: string;
}

export function HtmlBody({ html, allowImages, fallbackText }: HtmlBodyProps) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(0);
  const [showImages, setShowImages] = useState(false);

  const imagesOn = allowImages || showImages;

  const { html: clean, blockedImages } = useMemo(
    () => sanitizeBody(html, imagesOn),
    [html, imagesOn],
  );

  const doc = useMemo(() => readerDocument(clean, imagesOn), [clean, imagesOn]);

  /*
   * Size the frame to its content, and keep sizing it: an image finishing its
   * decode changes the height after load, and so does the reader's own width
   * when the window is resized.
   */
  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;

    let observer: ResizeObserver | null = null;

    const measure = () => {
      const body = frame.contentDocument?.body;
      if (!body) return;
      setHeight(Math.ceil(body.scrollHeight));
    };

    const onLoad = () => {
      measure();
      const body = frame.contentDocument?.body;
      if (body && typeof ResizeObserver !== 'undefined') {
        observer = new ResizeObserver(measure);
        observer.observe(body);
      }
    };

    frame.addEventListener('load', onLoad);
    // srcdoc may already have committed by the time this effect runs.
    if (frame.contentDocument?.readyState === 'complete') onLoad();

    return () => {
      frame.removeEventListener('load', onLoad);
      observer?.disconnect();
    };
  }, [doc]);

  // Nothing survived — an "HTML" body that was one tracking pixel, or markup
  // so broken the parser emptied it. The text half is what the rest of the
  // product reads anyway, so showing it is the honest fallback.
  if (!clean.trim()) {
    return <p className={cn('t-md', styles.fallback)}>{fallbackText}</p>;
  }

  return (
    <div className={styles.wrap}>
      {blockedImages > 0 && (
        <div className={cn('t-xs', styles.blocked)}>
          <span>Images aren&apos;t loaded.</span>
          <Button variant="tertiary" size="xs" onClick={() => setShowImages(true)}>
            Show images
          </Button>
        </div>
      )}
      <iframe
        ref={frameRef}
        className={styles.frame}
        style={{ height: height || undefined }}
        title="Message body"
        srcDoc={doc}
        /*
         * No `allow-scripts`, and never add it — see the note above. No
         * `allow-forms`: a phishing form in a message body should have
         * nowhere to post to. `allow-popups` is what lets a link the user
         * deliberately clicks open in their browser.
         */
        sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
        referrerPolicy="no-referrer"
      />
    </div>
  );
}
