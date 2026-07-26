import { useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { isScenarioName, providerForScenario } from '../data/mock/scenarios';
import { useMail } from '../store/mail';
import { useSettings } from '../store/settings';

/**
 * Dev-only. `?scenario=error` on any route swaps the mail provider for one that
 * produces that state, so §8.5 item 1's empty, loading and error states are
 * reachable through the real screens. Stripped from production builds by the
 * `import.meta.env.DEV` guard, which Vite folds away.
 */
export function useScenario(): void {
  const [params, setParams] = useSearchParams();
  const applied = useRef<string | null>(null);

  const scenario = params.get('scenario');
  const reset = params.get('reset');

  useEffect(() => {
    if (!import.meta.env.DEV) return;

    if (reset === '1') {
      useSettings.getState().setOnboarded(false);
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.delete('reset');
          return next;
        },
        { replace: true },
      );
      return;
    }

    if (!isScenarioName(scenario) || applied.current === scenario) return;
    applied.current = scenario;

    const mail = useMail.getState();
    mail.setProvider(providerForScenario(scenario));
    void mail.loadAccount();
    void mail.loadThreads('inbox');
    void mail.loadHeld();
    void mail.loadSenders();
    void mail.loadContacts();
  }, [scenario, reset, setParams]);
}
