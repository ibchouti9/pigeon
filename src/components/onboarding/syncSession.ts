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

/**
 * §3.1 3b's "Start sync again", which now genuinely starts again.
 *
 * It used to preserve the counter's position, because the copy promised Pigeon
 * would "pick up where it stopped" and a walk over the whole mailbox had a
 * position worth keeping. Setting up is a sample of sent mail and one window of
 * rows — seconds of bounded work with nothing part-done inside it — so the
 * honest retry is from the top, and the copy no longer claims otherwise.
 */
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
