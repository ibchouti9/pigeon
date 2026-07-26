import { useMemo } from 'react';
import { hasProvider, useSettings } from '../store/settings';
import { getAiClient } from './client';
import type { AiClient } from './types';

/**
 * The assistant, or null when no provider is connected. A null client is not an
 * error — every surface degrades to its underlying content per C-28 (D44).
 */
export function useAssistant(): { client: AiClient | null; connected: boolean } {
  const config = useSettings((s) => s.provider);
  return useMemo(
    () => ({ client: getAiClient(config), connected: hasProvider(config) }),
    [config],
  );
}

/** The three behaviour toggles from §5.13c. */
export function useBehaviour() {
  return useSettings((s) => s.behaviour);
}
