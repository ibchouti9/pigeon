import { isDesktop } from './desktop';

/**
 * `fetch`, routed around CORS on the desktop.
 *
 * In the browser this is `window.fetch` and nothing more. In the macOS app the
 * request is made by Rust instead, which matters twice over:
 *
 *  - the webview's origin is `tauri://localhost`, which no API's CORS policy
 *    has ever heard of;
 *  - the Anthropic API refuses browser-origin requests outright unless you send
 *    a header whose name is `anthropic-dangerous-direct-browser-access`, which
 *    is Anthropic telling you not to do it. Going through Rust means the key
 *    never sits in a web origin and the header is never needed.
 *
 * The plugin's `fetch` is API-compatible with the platform one, so call sites
 * only change which function they import.
 */
let desktopFetch: typeof fetch | null = null;

export async function httpFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  if (!isDesktop()) return fetch(input, init);
  if (!desktopFetch) {
    desktopFetch = (await import('@tauri-apps/plugin-http')).fetch as typeof fetch;
  }
  return desktopFetch(input, init);
}
