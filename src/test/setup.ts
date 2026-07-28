import '@testing-library/jest-dom/vitest';

/**
 * Node 26 ships its own `localStorage` global, and it wins.
 *
 * It is a getter on `globalThis` that returns `undefined` unless node is run
 * with `--localstorage-file`. Under vitest's jsdom environment `window` *is*
 * `globalThis`, so jsdom's own Storage never gets installed over it and every
 * `localStorage.clear()` in a `beforeEach` throws — 271 tests at the point this
 * was found, none of them about storage.
 *
 * `sessionStorage` is untouched because node defines only the one global.
 *
 * Replacing it rather than passing the node flag: the flag writes to a real
 * file, which would carry state between runs, and a test suite that shares a
 * mailbox across files is worse than one that cannot run.
 */
if (typeof globalThis.localStorage === 'undefined') {
  const entries = new Map<string, string>();
  const storage: Storage = {
    get length() {
      return entries.size;
    },
    key: (index: number) => [...entries.keys()][index] ?? null,
    getItem: (key: string) => entries.get(String(key)) ?? null,
    setItem: (key: string, value: string) => void entries.set(String(key), String(value)),
    removeItem: (key: string) => void entries.delete(String(key)),
    clear: () => entries.clear(),
  };
  Object.defineProperty(globalThis, 'localStorage', {
    value: storage,
    configurable: true,
    writable: true,
  });
}

/**
 * jsdom ships no matchMedia, and the app reads breakpoints through it. A stub
 * that always returns false would put every test at the fallback breakpoint;
 * this one actually evaluates min-width/max-width against the window, so a
 * test can resize and get the layout it asked for.
 */
const listeners = new Set<() => void>();

function evaluate(query: string): boolean {
  const width = window.innerWidth;
  let matches = true;
  for (const [, kind, value] of query.matchAll(/\((min|max)-width:\s*(\d+)px\)/g) as unknown as [
    string,
    string,
    string,
  ][]) {
    const px = Number(value);
    matches &&= kind === 'min' ? width >= px : width <= px;
  }
  // Anything Pigeon doesn't express as a width query (prefers-color-scheme,
  // prefers-reduced-motion) stays off by default.
  if (!/\((min|max)-width:/.test(query)) return false;
  return matches;
}

window.matchMedia = ((query: string) => ({
  get matches() {
    return evaluate(query);
  },
  media: query,
  onchange: null,
  addListener: (fn: () => void) => listeners.add(fn),
  removeListener: (fn: () => void) => listeners.delete(fn),
  addEventListener: (_: string, fn: () => void) => listeners.add(fn),
  removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
  dispatchEvent: () => false,
})) as unknown as typeof window.matchMedia;

/** Tests default to the desktop breakpoint; call this to move off it. */
export function setViewportWidth(width: number): void {
  Object.defineProperty(window, 'innerWidth', { value: width, configurable: true });
  listeners.forEach((fn) => fn());
  window.dispatchEvent(new Event('resize'));
}

setViewportWidth(1440);
