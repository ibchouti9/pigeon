import { useEffect, useRef, useState } from 'react';
import { cn } from '../../lib/cn';
import { CURATED_MODELS, testConnection } from '../../ai/client';
import { detectLocalEndpoint, preferredModel, type LocalEndpoint } from '../../ai/detectLocal';
import {
  DEFAULT_BASE_URL,
  PROVIDER_LABELS,
  useSettings,
  type ProviderConfig,
  type ProviderId,
} from '../../store/settings';
import { toast } from '../../store/toast';
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
 * D45 — a curated list per provider, updated in one place. That one place is
 * `CURATED_MODELS`, which the adapters also price against; duplicating it here
 * is how the select and the billing table drift apart.
 */
const MODEL_OPTIONS: Record<RemoteProvider, string[]> = {
  anthropic: CURATED_MODELS.anthropic,
  openai: CURATED_MODELS.openai,
  google: CURATED_MODELS.google,
  demo: CURATED_MODELS.demo,
};

function statusMessage(status: Status, providerName: string, baseUrl: string, ms?: number): string {
  switch (status) {
    case 'empty':
      return 'Your key is stored on this machine only.';
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
  if (providerId === 'demo') {
    return 'Demo replies are canned, not generated — nothing is sent anywhere. Connect a real provider any time in Settings → Assistant.';
  }
  return `Pigeon has no servers of its own — your key never leaves this machine except to reach ${PROVIDER_LABELS[providerId]}. Rotate or remove it any time in Settings → Assistant.`;
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
  /*
   * What the provider itself said, kept *alongside* §7.6's status line rather
   * than replacing it. The status line can only speak from the four statuses,
   * and one of them lies by omission: a model that refuses a *parameter* comes
   * back as `rejected`, so the panel sent the user off to re-check a key that
   * was never the problem. The adapter already quotes the API — this stopped
   * the panel from throwing that quote away.
   */
  const [testDetail, setTestDetail] = useState<string | null>(null);
  const [localModels, setLocalModels] = useState<string[] | null>(null);
  /*
   * What was already running when this screen opened.
   *
   * The people most likely to want Pigeon already have Ollama open, and making
   * them type `http://localhost:11434` into a field is asking them to
   * configure a thing Pigeon can simply look for. Found is not connected: the
   * card says what answered and fills the fields in, and the user still picks
   * Local and still presses Test.
   */
  const [found, setFound] = useState<LocalEndpoint | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [saving, setSaving] = useState(false);
  const revealTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (revealTimer.current) clearTimeout(revealTimer.current);
    },
    [],
  );

  useEffect(() => {
    let live = true;
    void detectLocalEndpoint().then((endpoint) => {
      if (!live || !endpoint) return;
      setFound(endpoint);
      setLocalModels(endpoint.models);
      /*
       * Fill the fields, select nothing. Preselecting Local would answer the
       * one question this screen exists to ask — and a probe that guesses
       * wrong would have pointed the assistant at a stranger's port.
       */
      setBaseUrl((current) => (current === DEFAULT_BASE_URL ? endpoint.baseUrl : current));
      setModel((current) => current || preferredModel(endpoint.models));
    });
    return () => {
      live = false;
    };
  }, []);

  function selectProvider(id: SelectableProvider) {
    setProviderId(id);
    setTestMs(undefined);
    setLocalModels(null);
    setRevealed(false);
    if (revealTimer.current) clearTimeout(revealTimer.current);
    if (id === 'local') {
      setApiKey('');
      // A probe already found the models; clearing them here would make the
      // select empty on the one provider where Pigeon knows the answer.
      setLocalModels(found?.models ?? null);
      setModel(found ? preferredModel(found.models) : '');
      setStatus(baseUrl.trim() ? 'entered' : 'empty');
    } else if (id === 'demo') {
      // No key, no base URL — canned replies, ready to test immediately.
      setApiKey('');
      setModel(MODEL_OPTIONS[id][0]);
      setStatus('entered');
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
    setTestDetail(null);
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
        setTestDetail(result.message ?? null);
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
    const previous = useSettings.getState().provider;
    useSettings.getState().setProvider({
      provider: providerId as ProviderId,
      apiKey: isLocalProvider ? '' : apiKey,
      baseUrl: isLocalProvider ? baseUrl : DEFAULT_BASE_URL,
      model,
    });
    useSettings.getState().setSkippedProvider(false);
    setSaving(false);

    // §5.13 — "every change saves immediately and confirms with a toast".
    // Nothing confirmed a provider save at all. §7.5 splits the copy: a first
    // connection confirms, a change offers to go back.
    const name = PROVIDER_LABELS[providerId as ProviderId] ?? providerId;
    // 'none' is the absence of a provider, not one to switch away from —
    // §7.5 splits "Connected to X." from "Switched to X.", and a first
    // connection after skipping the assistant is the former.
    const hadOne = previous.provider !== 'none' && previous.provider !== providerId;
    if (mount === 'settings' && hadOne) {
      toast.undo(`Switched to ${name}.`, 'Undo', () => {
        useSettings.getState().setProvider(previous);
      });
    } else if (mount === 'settings') {
      toast.confirm(`Connected to ${name}.`);
    }

    onSaved?.();
  }

  const isLocal = providerId === 'local';
  const isDemo = providerId === 'demo';
  const providerName = providerId ? PROVIDER_LABELS[providerId] : '';
  const invalid =
    status === 'rejected' ||
    status === 'no-credit' ||
    status === 'unreachable' ||
    status === 'offline';
  const canTest =
    providerId !== null &&
    status !== 'testing' &&
    (isDemo || (isLocal ? baseUrl.trim().length > 0 : apiKey.trim().length > 0));
  const canSave = status === 'connected' && (!isLocal || Boolean(model));

  const modelOptions: string[] =
    providerId && !isLocal ? MODEL_OPTIONS[providerId as RemoteProvider] : (localModels ?? []);

  return (
    <div>
      <section className={styles.section}>
        <span className={cn('t-mono-sm', styles.sectionLabel)}>PROVIDER</span>
        <ProviderRadioGroup value={providerId} onChange={selectProvider} />
        {found && providerId !== 'local' && (
          <p className={cn('t-sm', styles.found)}>
            <span className={styles.foundDot} aria-hidden="true" />
            <span>
              <span className={styles.foundName}>{found.runtime} is already running here</span>
              {' '}
              with {found.models.length === 1 ? 'one model' : `${found.models.length} models`}.
              Choose Local to use it — no key, and nothing leaves this Mac.
            </span>
          </p>
        )}
      </section>

      {providerId && (
        <>
          <section className={styles.section}>
            {!isDemo && (
              <label htmlFor="provider-key" className={cn('t-mono-sm', styles.sectionLabel)}>
                {isLocal ? 'BASE URL' : 'API KEY'}
              </label>
            )}
            <div className={styles.keyRow}>
              {!isDemo && (
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
              )}
              {!isDemo && !isLocal && (
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
            {testDetail && (
              <p className={cn('t-xs', 'ink-tertiary', styles.statusDetail)}>{testDetail}</p>
            )}
            <p className={cn('t-xs', 'ink-tertiary', styles.provenance)}>
              {provenanceNote(providerId)}
            </p>
          </section>

          <section className={styles.section}>
            <label htmlFor="provider-model" className={cn('t-mono-sm', styles.sectionLabel)}>
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
