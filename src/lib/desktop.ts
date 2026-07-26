/**
 * The seam between the two builds.
 *
 * Pigeon ships as a macOS app and as a web page from the same source. The
 * desktop build can do things a browser cannot — reach the Keychain, listen on
 * a loopback port, open the system browser, make requests no CORS policy gets a
 * say in — so a handful of places need to know which one they are running in.
 *
 * Every Tauri import here is dynamic. A static one would pull the plugin into
 * the web bundle for code that can never run there, and would make jsdom
 * resolve a native bridge that does not exist in tests.
 */

/** Tauri defines this on `window` before any app code runs. */
export function isDesktop(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

export async function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke: call } = await import('@tauri-apps/api/core');
  return call<T>(command, args);
}

/**
 * Sends a URL to the user's real browser.
 *
 * The setup guide links into the Google console, and the console is somewhere
 * the user is already signed in — in *their* browser, not in Pigeon's webview.
 * Opening it in the webview would show them a signed-out console and a login
 * form that Google refuses to serve inside an embedded user agent anyway.
 */
export async function openExternal(url: string): Promise<void> {
  if (!isDesktop()) {
    window.open(url, '_blank', 'noopener,noreferrer');
    return;
  }
  const { openUrl } = await import('@tauri-apps/plugin-opener');
  await openUrl(url);
}

/**
 * Fires `handler` with the paths of files dropped on the window.
 *
 * Returns an unsubscribe. On the web this is a no-op: the setup panel there
 * falls back to pasting, since a browser cannot hand a path to anyone.
 */
export function onFileDrop(handler: (paths: string[]) => void): () => void {
  if (!isDesktop()) return () => {};

  let stop: (() => void) | null = null;
  let cancelled = false;

  void (async () => {
    const { getCurrentWebview } = await import('@tauri-apps/api/webview');
    const unlisten = await getCurrentWebview().onDragDropEvent((event) => {
      if (event.payload.type === 'drop') handler(event.payload.paths);
    });
    if (cancelled) unlisten();
    else stop = unlisten;
  })();

  return () => {
    cancelled = true;
    stop?.();
  };
}
