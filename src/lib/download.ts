/**
 * Turns base64 bytes into a file the browser saves. D20 says attachments are
 * "receive, preview by filename, download" — the chip carried an accessible
 * name reading "Download …" and no handler, which is worse than no affordance
 * at all: it told the user it would work.
 */
export function downloadBase64(base64: string, filename: string, mimeType: string): void {
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
