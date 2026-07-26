import { useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useCompose } from '../store/compose';

/**
 * §2.2 puts the docked composer in the URL as `?compose=1`, "over any route".
 * It lived only in a zustand store, so the one piece of app state a user might
 * reasonably want to link to — "here, write to me about this" — could not be
 * linked to, and a reload lost an open composer without saying so.
 *
 * Written with `replace`, so an open composer never adds a history entry: the
 * back button belongs to the mail you were reading, not to a panel.
 */
export function useComposeParam(): void {
  const [params, setParams] = useSearchParams();
  const draft = useCompose((s) => s.draft);
  const open = useCompose((s) => s.open);
  const wanted = params.get('compose') === '1';
  const handled = useRef(false);

  // Arriving with ?compose=1 opens one, once.
  useEffect(() => {
    if (handled.current || !wanted) return;
    handled.current = true;
    if (!useCompose.getState().draft) open();
  }, [wanted, open]);

  // And the URL follows the composer from then on.
  useEffect(() => {
    const has = draft !== null;
    if (has === wanted) return;
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (has) next.set('compose', '1');
        else next.delete('compose');
        return next;
      },
      { replace: true },
    );
  }, [draft, wanted, setParams]);
}
