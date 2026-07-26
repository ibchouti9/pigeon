import { useNavigate } from 'react-router-dom';
import { OnboardingColumn } from '../../components/onboarding/OnboardingColumn';
import { ProviderPanel } from '../../components/onboarding/ProviderPanel';
import { cn } from '../../lib/cn';
import { DEFAULT_BASE_URL, useSettings } from '../../store/settings';
import styles from './ProviderSetupRoute.module.css';

export function ProviderSetupRoute() {
  const navigate = useNavigate();

  function handleSkip() {
    useSettings.getState().setProvider({
      provider: 'none',
      apiKey: '',
      baseUrl: DEFAULT_BASE_URL,
      model: '',
    });
    useSettings.getState().setSkippedProvider(true);
    navigate('/setup/sync');
  }

  return (
    <OnboardingColumn width={640}>
      <h1 className={cn('t-display-md', styles.heading)}>Connect your AI provider</h1>
      <p className={cn('t-md', styles.body)}>
        Pigeon doesn&apos;t run models of its own. Bring a key from a provider you already pay,
        or point Pigeon at a model running on your own machine. Your key is stored on this
        machine and sent only to the provider you pick.
      </p>

      <ProviderPanel
        mount="onboarding"
        onSaved={() => navigate('/setup/sync')}
        onSkip={handleSkip}
      />
    </OnboardingColumn>
  );
}
