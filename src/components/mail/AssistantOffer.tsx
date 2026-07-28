import { Button } from '../primitives/Button';
import { cn } from '../../lib/cn';
import { hasProvider, useSettings } from '../../store/settings';
import styles from './AssistantOffer.module.css';

/**
 * What replaced the provider step.
 *
 * O2 used to be the second screen of onboarding: a provider picker before the
 * user had seen a single message, with an imperative heading and a disabled
 * primary sitting next to the tertiary button that was the only way past it.
 * The step is gone from the flow, so the offer has to live somewhere — and
 * the inbox is the honest place for it, because here the user can already see
 * the mail the assistant would be summarising.
 *
 * It says what still works without a model rather than what is missing. Lanes
 * and the Screener both run on their deterministic half with no provider at
 * all, and nothing in the product ever said so — which made skipping the step
 * feel like leaving the app half-built.
 */
export interface AssistantOfferProps {
  /**
   * Where "Connect a model" goes. Passed in rather than navigated to here:
   * MailListColumn delegates every decision to its parent, and reaching for
   * `useNavigate` inside it would put the whole list column under a Router it
   * has never needed.
   */
  onConnect: () => void;
}

export function AssistantOffer({ onConnect }: AssistantOfferProps) {
  const provider = useSettings((s) => s.provider);
  const dismissed = useSettings((s) => s.dismissedAssistantOffer);

  if (dismissed || hasProvider(provider)) return null;

  return (
    <div className={styles.offer}>
      <p className={cn('t-sm', styles.text)}>
        Lanes and the Screener are sorting this mail already. Connect a model and Pigeon
        can also summarise a thread, draft a reply, and answer questions about your mail.
      </p>
      <div className={styles.actions}>
        <Button variant="secondary" size="sm" onClick={onConnect}>
          Connect a model
        </Button>
        <Button
          variant="tertiary"
          size="sm"
          onClick={() => useSettings.getState().dismissAssistantOffer()}
        >
          Not now
        </Button>
      </div>
    </div>
  );
}
