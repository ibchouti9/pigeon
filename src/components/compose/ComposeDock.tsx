import { useCompose } from '../../store/compose';

/**
 * §5.12 — the docked composer. Filled in by the composer module; the shell only
 * needs to know whether a draft is open.
 */
export function ComposeDock() {
  const draft = useCompose((s) => s.draft);
  if (!draft) return null;
  return null;
}
