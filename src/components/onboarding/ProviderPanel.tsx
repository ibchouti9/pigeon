import { useEffect, useRef, useState } from 'react';
import { cn } from '../../lib/cn';
import { testConnection } from '../../ai/client';
import {
  DEFAULT_BASE_URL,
  PROVIDER_LABELS,
  useSettings,
  type ProviderConfig,
  type ProviderId,
} from '../../store/settings';
import { Button } from '../primitives/Button';
import { Icon } from '../primitives/Icon';
import { Input } from '../primitives/Field';
import { ProviderRadioGroup, type SelectableProvider } from './ProviderCard';
import styles from './ProviderPanel.module.css';

type RemoteProvider = Exclude<SelectableProvider, 'local'>;

type Status =
  | 'empty'
  | 'entered'
  | 'testing'
  | 'connected'
  | 'rejected'
  | 'no-credit'
  | 'unreachable'
  | 'offline';

/**
 * The curated lists from C-27. Kept local rather than imported from
 * `src/ai/client.ts`'s `CURATED_MODELS` — that map currently has a typo
 * (`claude-sonnet-5` instead of `claude-sonnet-4-5`), so this is the
 * spec-accurate source of truth for the select. See the task report for the
 * cross-agent flag on that bug.
 */
const MODEL_OPTIONS: Record<RemoteProvider, string[]> = {
  anthropic: ['claude-sonnet-4-5', 'claude-haiku-4-5'],
  openai: ['gpt-5.1', 'gpt-5.1-mini'],
  google: ['gemini-3-pro', 'gemini-3-flash'],
};

function statusMessage(status: Status, providerName: string, baseUrl: string, ms?: number): string {
  switch (status) {
    case 'empty':
      return 'Your key is stored in this browser only.';
    case 'entered':
      return 'Press Test connection to check it works.';
    case 'testing':
      return `Checking with ${providerName}…`;
    case 'connected':
      return `Connected. Answered in ${ms ?? 0} ms.`;
    case 'rejected':
      return `${providerName} rejected this key. Check it in your provider dashboard and paste it again.`;
    case 'no-credit':
      return `${providerName} returned no credit on this account. Top up, or switch provider.`;
    case 'unreachable':
      return `Nothing is answering at ${baseUrl}. Start your local model, then test again.`;
    case 'offline':
      return `Couldn't reach ${providerName}. Check your connection and test again.`;
  }
}

function statusDotClass(status: Status): string | null {
  switch (status) {
    case 'testing':
      return styles.dotTertiary;
    case 'connected':
      return styles.dotAccent;
    case 'rejected':
    case 'no-credit':
    case 'unreachable':
    case 'offline':
      return styles.dotDestructive;
    default:
      return null;
  }
}

function provenanceNote(providerId: SelectableProvider): string {
  if (providerId === 'local') {
    return 'Nothing leaves your machine. Pigeon talks to the endpoint above and nowhere else.';
  }
  return `Pigeon has no servers of its own — your key never leaves this browser except to reach ${PROVIDER_LABELS[providerId]}. Rotate or remove it any time in Settings → Assistant.`;
}

export interface ProviderPanelProps {
  /** The component behind both O2 (§5.2) and Settings → Assistant (§5.13c). */
  mount: 'onboarding' | 'settings';
  /** Called after the config is written to the store by "Save and continue". */
  onSaved?: () => void;
  /** Renders "Continue without the assistant" — onboarding only (§5.2). */
  onSkip?: () => void;
  /** Renders a "Cancel" action that leaves the store untouched. */
  onCancel?: () => void;
}

/** C-27 — one panel, two mounts. Reads and writes `useSettings` directly. */
export function ProviderPanel({ mount, onSaved, onSkip, onCancel }: ProviderPanelProps) {
  const savedProvider = useSettings((s) => s.provider);

  const initialProviderId: SelectableProvider | null =
    savedProvider.provider === 'anthropic' ||
    savedProvider.provider === 'openai' ||
    savedProvider.provider === 'google' ||
    savedProvider.provider === 'local'
      ? savedProvider.provider
      : null;

  const [providerId, setProviderId] = useState<SelectableProvider | null>(initialProviderId);
  const [apiKey, setApiKey] = useState(
    initialProviderId && initialProviderId !== 'local' ? savedProvider.apiKey : '',
  );
  const [baseUrl, setBaseUrl] = useState(savedProvider.baseUrl || DEFAULT_BASE_URL);
  const [model, setModel] = useState(
    initialProviderId && initialProviderId !== 'local' ? savedProvider.model : '',
  );
  const [status, setStatus] = useState<Status>(() => {
    if (initialProviderId === 'local') return baseUrl.trim() ? 'entered' : 'empty';
    if (initialProviderId) return apiKey.trim() ? 'entered' : 'empty';
    return 'empty';
  });
  const [testMs, setTestMs] = useState<number | undefined>(undefined);
  const [localModels, setLocalModels] = useState<string[] | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [saving, setSaving] = useState(false);
  const revealTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (revealTimer.current) clearTimeout(revealTimer.current);
    },
    [],
  );

  function selectProvider(id: SelectableProvider) {
    setProviderId(id);
    setTestMs(undefined);
    setLocalModels(null);
    setRevealed(false);
    if (revealTimer.current) clearTimeout(revealTimer.current);
    if (id === 'local') {
      setApiKey('');
      setModel('');
      setStatus(baseUrl.trim() ? 'entered' : 'empty');
    } else {
      setApiKey('');
      setModel(MODEL_OPTIONS[id][0]);
      setStatus('empty');
    }
  }

  function updateKey(v: string) {
    setApiKey(v);
    setStatus(v.trim() ? 'entered' : 'empty');
  }

  function updateBaseUrl(v: string) {
    setBaseUrl(v);
    setStatus(v.trim() ? 'entered' : 'empty');
  }

  function toggleReveal() {
    if (revealTimer.current) clearTimeout(revealTimer.current);
    if (revealed) {
      setRevealed(false);
      return;
    }
    setRevealed(true);
    revealTimer.current = setTimeout(() => setRevealed(false), 10_000);
  }

  async function handleTest() {
    if (!providerId) return;
    const isLocalProvider = providerId === 'local';
    setStatus('testing');
    const config: ProviderConfig = {
      provider: providerId,
      apiKey: isLocalProvider ? '' : apiKey,
      baseUrl: isLocalProvider ? baseUrl : DEFAULT_BASE_URL,
      model: model || (isLocalProvider ? '' : MODEL_OPTIONS[providerId as RemoteProvider][0]),
    };
    try {
      const result = await testConnection(config);
      if (result.ok) {
        setStatus('connected');
        setTestMs(result.ms);
        useSettings.getState().setConnection('connected');
        if (isLocalProvider && result.models && result.models.length > 0) {
          setLocalModels(result.models);
          setModel((m) => m || result.models![0]);
        }
      } else {
        setStatus(result.status);
        useSettings.getState().setConnection(result.status === 'rejected' ? 'rejected' : 'unknown');
      }
    } catch {
      setStatus('offline');
      useSettings.getState().setConnection('unknown');
    }
  }

  function handleSave() {
    if (!providerId) return;
    setSaving(true);
    const isLocalProvider = providerId === 'local';
    useSettings.getState().setProvider({
      provider: providerId as ProviderId,
      apiKey: isLocalProvider ? '' : apiKey,
      baseUrl: isLocalProvider ? baseUrl : DEFAULT_BASE_URL,
      model,
    });
    useSettings.getState().setSkippedProvider(false);
    setSaving(false);
    onSaved?.();
  }

  const isLocal = providerId === 'local';
  const providerName = providerId ? PROVIDER_LABELS[providerId] : '';
  const invalid =
    status === 'rejected' ||
    status === 'no-credit' ||
    status === 'unreachable' ||
    status === 'offline';
  const canTest =
    providerId !== null &&
    status !== 'testing' &&
    (isLocal ? baseUrl.trim().length > 0 : apiKey.trim().length > 0);
  const canSave = status === 'connected' && (!isLocal || Boolean(model));

  const modelOptions: string[] =
    providerId && !isLocal ? MODEL_OPTIONS[providerId as RemoteProvider] : (localModels ?? []);

  return (
    <div>
      <section className={styles.section}>
        <span className={cn('t-mono-xs', styles.sectionLabel)}>PROVIDER</span>
        <ProviderRadioGroup value={providerId} onChange={selectProvider} />
      </section>

      {providerId && (
        <>
          <section className={styles.section}>
            <label htmlFor="provider-key" className={cn('t-mono-xs', styles.sectionLabel)}>
              {isLocal ? 'BASE URL' : 'API KEY'}
            </label>
            <div className={styles.keyRow}>
              <Input
                id="provider-key"
                size="xs"
                mono={!isLocal}
                type={isLocal ? 'text' : revealed ? 'text' : 'password'}
                autoComplete="off"
                spellCheck={false}
                value={isLocal ? baseUrl : apiKey}
                onChange={(e) => (isLocal ? updateBaseUrl(e.target.value) : updateKey(e.target.value))}
                invalid={invalid}
                aria-describedby="provider-status"
                className={styles.keyInput}
                placeholder={isLocal ? DEFAULT_BASE_URL : undefined}
              />
              {!isLocal && (
                <button
                  type="button"
                  aria-pressed={revealed}
                  className={cn('t-sm', styles.showButton)}
                  onClick={toggleReveal}
                >
                  {revealed ? 'Hide key' : 'Show key'}
                </button>
              )}
              <Button
                variant="secondary"
                size="xs"
                style={{ height: 34 }}
                loading={status === 'testing'}
                disabled={!canTest}
                onClick={handleTest}
              >
                Test connection
              </Button>
            </div>
            <p
              id="provider-status"
              role="status"
              aria-live="polite"
              className={cn('t-sm', styles.statusLine)}
            >
              {statusDotClass(status) && (
                <span className={cn(styles.dot, statusDotClass(status))} aria-hidden="true" />
              )}
              {statusMessage(status, providerName, baseUrl, testMs)}
            </p>
            <p className={cn('t-xs', 'ink-tertiary', styles.provenance)}>
              {provenanceNote(providerId)}
            </p>
          </section>

          <section className={styles.section}>
            <label htmlFor="provider-model" className={cn('t-mono-xs', styles.sectionLabel)}>
              MODEL
            </label>
            <div className={styles.modelWrap}>
              <select
                id="provider-model"
                className={styles.modelSelect}
                value={model}
                disabled={modelOptions.length === 0}
                onChange={(e) => setModel(e.target.value)}
              >
                {modelOptions.length === 0 && (
                  <option value="">Test connection to see models</option>
                )}
                {modelOptions.map((id) => (
                  <option key={id} value={id}>
                    {id}
                  </option>
                ))}
              </select>
              <span className={cn('t-mono-sm', styles.modelJobs)} aria-hidden="true">
                summaries · reads · drafts
              </span>
              <Icon name="chevron-down" size={16} className={styles.modelChevron} />
            </div>
          </section>
        </>
      )}

      <div className={styles.actions}>
        <Button variant="primary" disabled={!canSave} loading={saving} onClick={handleSave}>
          Save and continue
        </Button>
        {mount === 'onboarding' && onSkip && (
          <Button variant="tertiary" onClick={onSkip}>
            Continue without the assistant
          </Button>
        )}
        {mount === 'settings' && onCancel && (
          <Button variant="tertiary" onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>
    </div>
  );
}
