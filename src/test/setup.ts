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

/**
 * One comma-free clause: every `(min|max)-(width|height)` in it, ANDed.
 *
 * Anything Pigeon does not express as a size — `prefers-color-scheme`,
 * `prefers-reduced-motion`, `hover` — stays off, which is what leaves tests on
 * the light theme with motion enabled.
 */
function clause(part: string): boolean {
  const features = [...part.matchAll(/\((min|max)-(width|height):\s*(\d+)px\)/g)];
  if (features.length === 0) return false;
  return features.every(([, kind, axis, value]) => {
    const actual = axis === 'width' ? window.innerWidth : window.innerHeight;
    return kind === 'min' ? actual >= Number(value) : actual <= Number(value);
  });
}

/**
 * A comma in a media query is OR, and the phone breakpoint is written
 * `(max-width: 719px), (max-height: 449px)` — so a stub that ANDed the two
 * would report a 375px-wide, 800px-tall viewport as *not* a phone, and every
 * test of the mobile shell would silently exercise the desktop one.
 */
function evaluate(query: string): boolean {
  return query.split(',').some((part) => clause(part.trim()));
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

/**
 * Tests default to the desktop breakpoint; call this to move off it.
 *
 * The height is set alongside the width, and generously, because the phone
 * breakpoint is `(max-width: 719px), (max-height: 449px)` — jsdom's default
 * `innerHeight` is 768, which is over the line, but a test that set only the
 * width would be one jsdom default away from silently landing on a phone.
 */
export function setViewportWidth(width: number, height = 900): void {
  Object.defineProperty(window, 'innerWidth', { value: width, configurable: true });
  Object.defineProperty(window, 'innerHeight', { value: height, configurable: true });
  listeners.forEach((fn) => fn());
  window.dispatchEvent(new Event('resize'));
}

setViewportWidth(1440);
