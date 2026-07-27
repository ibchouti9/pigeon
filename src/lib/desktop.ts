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
 * Subscribes to an event the engine emits mid-command.
 *
 * A listing walks the metadata of every message in a place before it can group
 * anything into conversations, and on a large account that is a minute of work
 * inside one `invoke`. Without this the screen has nothing to show for it, which
 * is indistinguishable from a hang — it was reported as one.
 *
 * Resolves to a no-op unsubscriber in the web build, where nothing emits.
 */
export async function listen<T>(
  event: string,
  handler: (payload: T) => void,
): Promise<() => void> {
  if (!isDesktop()) return () => {};
  try {
    const { listen: subscribe } = await import('@tauri-apps/api/event');
    const unlisten = await subscribe<T>(event, (e) => handler(e.payload));
    return unlisten;
  } catch {
    // Progress is a courtesy; losing it must not fail the work it describes.
    return () => {};
  }
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

