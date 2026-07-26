import { useMail } from '../../store/mail';
import type { SyncProgress } from '../../types';

/**
 * O3 (§5.2b) lets the user hit Continue at 20% and move on to O4/O5 while
 * sync keeps running. A plain component-local effect would be torn down on
 * navigation, so sync is driven from this module-level singleton instead —
 * started once, independent of which route is mounted.
 *
 * This is a local workaround, not a store: it does not touch `src/store/**`.
 */

type Listener = (p: SyncProgress) => void;

let started = false;
let latest: SyncProgress = { total: null, done: 0, step: 'connect' };
const listeners = new Set<Listener>();

function emit(p: SyncProgress) {
  latest = p;
  for (const l of listeners) l(p);
}

export function startSync(): void {
  if (started) return;
  started = true;
  useMail
    .getState()
    .provider.sync((p) => emit(p))
    .catch((err: unknown) => {
      emit({
        ...latest,
        error: err instanceof Error ? err.message : 'Gmail returned an error.',
      });
    });
}

export function getSyncProgress(): SyncProgress {
  return latest;
}

export function subscribeSync(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Lets "Start sync again" (§3.1 3b) restart a failed run from this screen. */
export function retrySync(): void {
  started = false;
  latest = { total: null, done: 0, step: 'connect' };
  startSync();
}

/** Test-only: return the singleton to its pristine state between specs. */
export function resetSyncSessionForTest(): void {
  started = false;
  latest = { total: null, done: 0, step: 'connect' };
  listeners.clear();
}
