import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * D41 — the user brings their own model. `demo` is the exception: canned
 * assistant output so the AI surfaces can be run and reviewed without a key.
 * It is labelled as a demo everywhere it appears.
 */
export type ProviderId = 'anthropic' | 'openai' | 'google' | 'local' | 'demo' | 'none';
export type Appearance = 'system' | 'light' | 'dark';

export interface ProviderConfig {
  provider: ProviderId;
  /**
   * D42 — stored in this browser under `pigeon.provider` and sent to no origin
   * except the chosen provider's API. Empty for the local provider.
   */
  apiKey: string;
  baseUrl: string;
  model: string;
}

export interface BehaviourFlags {
  autoSummarize: boolean;
  screenerReads: boolean;
  matchWritingStyle: boolean;
}

export interface UsageStats {
  /** Month-to-date, in USD. Reported, never enforced (D46). */
  spendUsd: number;
  calls: number;
  /** ISO 8601 of the last provider call. */
  lastCallAt?: string;
  lastCallMs?: number;
  /** `YYYY-MM` — usage resets when the month rolls over. */
  month: string;
}

/** Drives the status pill in Settings → Assistant (§5.13c). */
export type ConnectionStatus = 'unknown' | 'connected' | 'rejected';

interface SettingsState {
  provider: ProviderConfig;
  behaviour: BehaviourFlags;
  appearance: Appearance;
  usage: UsageStats;
  /** Result of the last connection test, so the pill survives a reload. */
  connection: ConnectionStatus;
  /** True once O1–O5 have been completed for this account. */
  onboarded: boolean;
  /** Set when the user chose "Continue without the assistant" on O2. */
  skippedProvider: boolean;

  setProvider: (config: Partial<ProviderConfig>) => void;
  removeKey: () => void;
  setBehaviour: (flags: Partial<BehaviourFlags>) => void;
  setAppearance: (a: Appearance) => void;
  setConnection: (status: ConnectionStatus) => void;
  recordCall: (usd: number, ms: number) => void;
  setOnboarded: (v: boolean) => void;
  setSkippedProvider: (v: boolean) => void;
}

export const DEFAULT_BASE_URL = 'http://localhost:11434';

export const PROVIDER_LABELS: Record<ProviderId, string> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  google: 'Google',
  local: 'Local',
  demo: 'Demo',
  none: 'None',
};

function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

const emptyProvider: ProviderConfig = {
  provider: 'none',
  apiKey: '',
  baseUrl: DEFAULT_BASE_URL,
  model: '',
};

export const useSettings = create<SettingsState>()(
  persist(
    (set, get) => ({
      provider: emptyProvider,
      behaviour: {
        autoSummarize: true,
        screenerReads: true,
        matchWritingStyle: true,
      },
      appearance: 'system',
      usage: { spendUsd: 0, calls: 0, month: currentMonth() },
      connection: 'unknown',
      onboarded: false,
      skippedProvider: false,

      setProvider: (config) =>
        set((s) => ({ provider: { ...s.provider, ...config } })),

      removeKey: () => set({ provider: { ...emptyProvider }, connection: 'unknown' }),

      setBehaviour: (flags) => set((s) => ({ behaviour: { ...s.behaviour, ...flags } })),

      setAppearance: (appearance) => set({ appearance }),

      setConnection: (connection) => set({ connection }),

      recordCall: (usd, ms) => {
        const month = currentMonth();
        const prev = get().usage;
        const base = prev.month === month ? prev : { spendUsd: 0, calls: 0, month };
        set({
          usage: {
            month,
            spendUsd: base.spendUsd + usd,
            calls: base.calls + 1,
            lastCallAt: new Date().toISOString(),
            lastCallMs: ms,
          },
        });
      },

      setOnboarded: (onboarded) => set({ onboarded }),
      setSkippedProvider: (skippedProvider) => set({ skippedProvider }),
    }),
    { name: 'pigeon.provider' },
  ),
);

/** True when an AI surface should render its full form rather than C-28. */
export function hasProvider(config: ProviderConfig): boolean {
  if (config.provider === 'none') return false;
  if (config.provider === 'demo') return Boolean(config.model);
  if (config.provider === 'local') return Boolean(config.baseUrl && config.model);
  return Boolean(config.apiKey && config.model);
}
