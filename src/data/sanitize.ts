import DOMPurify from 'dompurify';

/**
 * Turning a stranger's HTML into something safe to show.
 *
 * Message bodies rendered as plain text until now, which made C-8's
 * "sanitized HTML" prop and its whole blocked-images state unreachable
 * (PROGRESS deviation 14). The reason to be careful is not theoretical: a mail
 * body is markup written by someone who has not been approved yet, and the
 * Screener exists precisely because that person is a stranger.
 *
 * Three independent layers hold, and each would be sufficient on its own for
 * most of what the others catch:
 *
 *  1. This sanitizer, which drops scripts, event handlers, and anything that
 *     can navigate or submit.
 *  2. A `sandbox`ed iframe with neither `allow-same-origin` nor
 *     `allow-forms`, so the document cannot reach this app's origin, its
 *     storage, or the user's session even if something here is missed.
 *  3. A CSP inside that iframe with `default-src 'none'`, so nothing it
 *     contains can make a network request of any kind — which is what makes
 *     the tracking pixel in a marketing email inert rather than merely
 *     invisible.
 *
 * `RETURN_TRUSTED_TYPE` is deliberately off: the result goes into an iframe's
 * `srcdoc` as a string, never into this document.
 */

/**
 * Tags a message may use. Everything structural and nothing that loads, runs
 * or navigates on its own.
 *
 * `<style>` is not among them, and losing it costs less than it sounds:
 * Gmail and Outlook have stripped style blocks for years, so mail that wants
 * to look like anything already carries its CSS inline, and the `style`
 * attribute is allowed below. DOMPurify drops the tag regardless of this list
 * unless the browser hands it a CSS parser it trusts.
 */
const ALLOWED_TAGS = [
  'a', 'abbr', 'address', 'b', 'blockquote', 'br', 'caption', 'center', 'cite',
  'code', 'col', 'colgroup', 'dd', 'del', 'div', 'dl', 'dt', 'em', 'figcaption',
  'figure', 'font', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'i', 'img', 'ins',
  'li', 'mark', 'ol', 'p', 'pre', 'q', 's', 'section', 'small', 'span', 'strike',
  'strong', 'sub', 'sup', 'table', 'tbody', 'td', 'tfoot', 'th',
  'thead', 'tr', 'u', 'ul', 'wbr',
];

const ALLOWED_ATTR = [
  'align', 'alt', 'bgcolor', 'border', 'cellpadding', 'cellspacing', 'class',
  'color', 'colspan', 'dir', 'face', 'height', 'href', 'hspace', 'id', 'lang',
  'rowspan', 'size', 'span', 'src', 'style', 'title', 'valign', 'vspace',
  'width',
];

/**
 * Everything that reaches the network or the surrounding page. Listed as well
 * as omitted from the allowlist above: `FORBID_TAGS` wins over any future
 * edit that widens the allowlist by accident.
 */
const FORBID_TAGS = [
  'script', 'iframe', 'object', 'embed', 'form', 'input', 'button', 'select',
  'textarea', 'link', 'meta', 'base', 'audio', 'video', 'source', 'track',
  'svg', 'math', 'template', 'noscript', 'frame', 'frameset', 'applet',
];

const FORBID_ATTR = ['srcset', 'formaction', 'ping', 'background', 'lowsrc'];

export interface SanitizedBody {
  html: string;
  /** How many remote images were held back, for C-8's blocked-images strip. */
  blockedImages: number;
}

/** A URL that fetches something from somewhere else when the page renders. */
function isRemote(url: string): boolean {
  return /^(https?:)?\/\//i.test(url.trim());
}

/**
 * Sanitizes a message body, and optionally defuses its remote images.
 *
 * C-8 blocks images for senders approved less than 24 hours ago. The address
 * is moved to `data-blocked-src` rather than deleted so that "Show images"
 * costs a re-render and not a re-fetch of the message — and so the count in
 * the strip is the truth rather than an estimate.
 */
export function sanitizeBody(html: string, allowImages: boolean): SanitizedBody {
  let blockedImages = 0;

  const hook = (node: Element) => {
    if (node.tagName === 'A') {
      // Mail is read in a sandbox with `allow-popups`; a link that opens in
      // place would replace the message with the destination.
      node.setAttribute('target', '_blank');
      node.setAttribute('rel', 'noopener noreferrer');
    }
    if (node.tagName === 'IMG' && !allowImages) {
      const src = node.getAttribute('src') ?? '';
      if (isRemote(src)) {
        blockedImages += 1;
        node.setAttribute('data-blocked-src', src);
        node.removeAttribute('src');
      }
    }
  };

  DOMPurify.addHook('afterSanitizeAttributes', hook);
  try {
    const clean = DOMPurify.sanitize(html, {
      ALLOWED_TAGS,
      ALLOWED_ATTR,
      FORBID_TAGS,
      FORBID_ATTR,
      // `javascript:` and friends. data: URLs stay reachable for the inline
      // images a message legitimately carries as attachments.
      ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|tel|data|cid):|[^a-z]|[a-z+.-]+(?:[^a-z+.\-:]|$))/i,
      WHOLE_DOCUMENT: false,
      RETURN_DOM: false,
      RETURN_DOM_FRAGMENT: false,
    });
    return { html: String(clean), blockedImages };
  } finally {
    // Hooks are global to the module; leaving this one installed would apply
    // one message's image policy to the next message sanitized.
    DOMPurify.removeHook('afterSanitizeAttributes');
  }
}

/**
 * The `srcdoc` for the reader's iframe.
 *
 * Always light, and never themed to match the app. A sender writes their mail
 * against a white background — the receipt below sets `#111827` text and no
 * background at all — so painting our dark surface underneath it produces
 * dark text on dark, message by message, with no way to predict which ones.
 * Gmail and Apple Mail both put HTML mail on white for the same reason. The
 * frame is styled as a sheet of paper so it reads as deliberate.
 *
 * The CSP is the layer that makes a tracking pixel genuinely inert, and it is
 * carrying real weight rather than backing up the sanitizer: a pixel written
 * as `style="background:url(https://…)"` passes sanitization intact, because
 * it is a legitimate declaration. `img-src` is what stops it being fetched —
 * CSS background images are governed by that directive too.
 *
 * `default-src 'none'` means no fetch of any kind — no beacon, no font, no
 * stylesheet, no XHR — and `img-src` opens by exactly one step when the user
 * asks for images. There is no `script-src` at all, so nothing runs even if a
 * `<script>` survived the sanitizer above.
 *
 * The blocked-images count only sees `<img>`, so a message whose only tracker
 * is a CSS background shows no strip. It is still blocked; it is just not
 * announced, which is the right way round of the two.
 */
export function readerDocument(bodyHtml: string, allowImages: boolean): string {
  const imgSrc = allowImages ? 'img-src https: data: cid:;' : 'img-src data: cid:;';
  return `<!doctype html>
<html><head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; ${imgSrc} style-src 'unsafe-inline'; base-uri 'none'; form-action 'none';">
<style>
  html, body { margin: 0; background: transparent; }
  html { padding: 0; }
  body {
    /* The paper's margin lives here rather than on the iframe element: the
       frame is sized from this document's scrollHeight, which cannot see
       padding applied on the other side of the boundary — so putting it there
       clipped the last line of every message. */
    padding: 16px;
    font: 15px/1.6 -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    color: #1B2027;
    word-break: break-word;
    overflow-wrap: anywhere;
  }
  /* A message cannot widen the reader, whatever its own table says. */
  * { max-width: 100% !important; }
  table { table-layout: auto !important; }
  img { height: auto; }
  a { color: #1F7A5C; }
  blockquote {
    margin: 0 0 0 12px; padding-left: 12px;
    border-left: 2px solid #DDE2E8;
  }
  /* A blocked image would otherwise render as a broken-image glyph. */
  img:not([src]) { display: none; }
</style>
</head><body>${bodyHtml}</body></html>`;
}
