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
  /**
   * Whether a question typed into search is answered without being asked
   * twice.
   *
   * `parseQuery` has already decided the query *is* a question before the
   * offer appears — it wants a question mark, or a question word and four
   * words — so the button was a second confirmation of something Pigeon had
   * settled. The other three assistant surfaces all run on their own; this
   * one was the exception.
   */
  answerQuestions: boolean;
  matchWritingStyle: boolean;
  /**
   * Whether the assistant is asked about the inbox threads the deterministic
   * lane rules were unsure of. Off leaves lanes working exactly as they do
   * with no provider connected — the rules alone, which is most threads.
   */
  sortInbox: boolean;
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
  /**
   * Set when the inbox's assistant offer has been waved away.
   *
   * The provider step left the required flow, so this card is what replaces
   * it. It has to be dismissible and it has to stay dismissed, or it becomes
   * the nag that the step it replaced at least only asked once.
   */
  dismissedAssistantOffer: boolean;

  setProvider: (config: Partial<ProviderConfig>) => void;
  removeKey: () => void;
  setBehaviour: (flags: Partial<BehaviourFlags>) => void;
  setAppearance: (a: Appearance) => void;
  setConnection: (status: ConnectionStatus) => void;
  recordCall: (usd: number, ms: number) => void;
  setOnboarded: (v: boolean) => void;
  setSkippedProvider: (v: boolean) => void;
  dismissAssistantOffer: () => void;
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
        answerQuestions: true,
        matchWritingStyle: true,
        sortInbox: true,
      },
      appearance: 'system',
      usage: { spendUsd: 0, calls: 0, month: currentMonth() },
      connection: 'unknown',
      onboarded: false,
      dismissedAssistantOffer: false,
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
      dismissAssistantOffer: () => set({ dismissedAssistantOffer: true }),
    }),
    {
      name: 'pigeon.provider',
      /*
       * Deep-merge the nested groups, rather than letting stored state replace
       * them wholesale.
       *
       * zustand's default merge is shallow, so a `behaviour` object written
       * before a flag existed replaces the defaults entirely and the new flag
       * arrives `undefined` — which reads as off. Adding
       * `answerQuestions` was the first time that showed: the setting
       * defaulted to on, and every existing install had it silently off with
       * no way to tell from the settings screen, which renders a switch from
       * the same undefined value.
       *
       * Every future flag would have had the same problem.
       */
      merge: (persisted, current) => {
        const stored = (persisted ?? {}) as Partial<SettingsState>;
        return {
          ...current,
          ...stored,
          behaviour: { ...current.behaviour, ...(stored.behaviour ?? {}) },
          provider: { ...current.provider, ...(stored.provider ?? {}) },
        };
      },
    },
  ),
);

/** True when an AI surface should render its full form rather than C-28. */
export function hasProvider(config: ProviderConfig): boolean {
  if (config.provider === 'none') return false;
  if (config.provider === 'demo') return Boolean(config.model);
  if (config.provider === 'local') return Boolean(config.baseUrl && config.model);
  return Boolean(config.apiKey && config.model);
}
