import { invoke, isIos } from './desktop';

/**
 * Hands an attachment to whatever this platform means by "open it".
 *
 * Two different verbs behind one call. A desktop saves — a blob URL, an
 * `<a download>`, and the browser does the rest. A phone previews: tap a PDF
 * and it opens, with Share and "Open in…" attached, which is what every mail
 * client on iOS does and what nobody expects a Downloads folder for.
 *
 * That split is not a preference. WKWebView ignores the download attribute
 * *and* the blob navigation, so the desktop route ends in silence on a phone —
 * a chip that says it works and does nothing, which is the exact state the
 * comment below says this function was written to get out of.
 */
export async function openAttachment(
  base64: string,
  filename: string,
  mimeType: string,
): Promise<void> {
  if (isIos()) {
    await invoke('attachment_present', { filename, base64 });
    return;
  }
  downloadBase64(base64, filename, mimeType);
}

/**
 * The desktop half. Not exported: `openAttachment` is the only way in, so
 * there is no route to the branch that does nothing on a phone.
 *
 * Turns base64 bytes into a file the browser saves. D20 says attachments are
 * "receive, preview by filename, download" — the chip carried an accessible
 * name reading "Download …" and no handler, which is worse than no affordance
 * at all: it told the user it would work.
 */
function downloadBase64(base64: string, filename: string, mimeType: string): void {
  const binary = atob(base64);
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: mimeType }));

  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();

  // Revoking immediately can race the save in some browsers; a frame is enough.
  requestAnimationFrame(() => URL.revokeObjectURL(url));
}
