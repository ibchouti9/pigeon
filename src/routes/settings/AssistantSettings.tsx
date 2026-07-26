import { useState } from 'react';
import { SettingsPage } from '../../components/settings/SettingsPage';
import { Button } from '../../components/primitives/Button';
import { Switch } from '../../components/primitives/Field';
import { ProviderPanel } from '../../components/onboarding/ProviderPanel';
import {
  useSettings,
  hasProvider,
  PROVIDER_LABELS,
  DEFAULT_BASE_URL,
  type BehaviourFlags,
  type ProviderConfig,
} from '../../store/settings';
import { toast } from '../../store/toast';
import { formatSpend, plural, relativeTime } from '../../lib/format';
import { cn } from '../../lib/cn';
import styles from './AssistantSettings.module.css';

/** C-27's curated endpoints — the remote providers only, Local uses its own base URL. */
const ENDPOINTS: Partial<Record<ProviderConfig['provider'], string>> = {
  anthropic: 'api.anthropic.com',
  openai: 'api.openai.com',
  google: 'generativelanguage.googleapis.com',
};

interface BehaviourRow {
  key: keyof BehaviourFlags;
  label: string;
  description: string;
  onCopy: string;
  offCopy: string;
}

/** §7.8 — only the "automatic summaries" toast is given verbatim in the spec;
 * the other two follow the same "what changed, on/off" pattern. */
const BEHAVIOUR_ROWS: BehaviourRow[] = [
  {
    key: 'autoSummarize',
    label: 'Summarize long threads automatically',
    description: 'Pigeon writes a summary for threads with four or more messages.',
    onCopy: 'Automatic summaries are on.',
    offCopy: 'Automatic summaries are off.',
  },
  {
    key: 'screenerReads',
    label: 'Read new senders for the Screener',
    description: "Pigeon adds a one-line read to each sender card and writes the weekly digest.",
    onCopy: 'Screener reads are on.',
    offCopy: 'Screener reads are off.',
  },
  {
    key: 'matchWritingStyle',
    label: 'Match my writing style in drafts',
    description: "Pigeon looks at mail you've sent to write drafts that sound like you.",
    onCopy: 'Writing-style matching is on.',
    offCopy: 'Writing-style matching is off.',
  },
];

function endpointFor(config: ProviderConfig): string {
  if (config.provider === 'local') return config.baseUrl || DEFAULT_BASE_URL;
  return ENDPOINTS[config.provider] ?? '';
}

function maskedKey(config: ProviderConfig): string {
  if (config.provider === 'local') return config.baseUrl || DEFAULT_BASE_URL;
  if (!config.apiKey) return '';
  return config.apiKey.length <= 4 ? '••••' : `••••${config.apiKey.slice(-4)}`;
}

/** §5.13c Assistant — Provider block, then Behaviour block. */
export function AssistantSettings() {
  const provider = useSettings((s) => s.provider);
  const usage = useSettings((s) => s.usage);
  const behaviour = useSettings((s) => s.behaviour);
  const setBehaviour = useSettings((s) => s.setBehaviour);
  const setProvider = useSettings((s) => s.setProvider);
  const removeKey = useSettings((s) => s.removeKey);

  // "Change" (and, for lack of a connection-testing surface of our own,
  // "Test connection") reopen the shared O2 form inline — see the report
  // for why Test connection delegates here rather than testing itself.
  const [editing, setEditing] = useState(false);

  const connected = hasProvider(provider);
  const label = PROVIDER_LABELS[provider.provider];

  function handleRemoveKey() {
    const snapshot = { ...provider };
    removeKey();
    toast.undo(`Removed your ${label} key.`, 'Undo', () => {
      setProvider(snapshot);
    });
  }

  function handleToggle(row: BehaviourRow, next: boolean) {
    setBehaviour({ [row.key]: next } as Partial<BehaviourFlags>);
    toast.confirm(next ? row.onCopy : row.offCopy);
  }

  return (
    <SettingsPage>
      <h1 className="t-xl">Assistant</h1>

      <section className={styles.providerBlock}>
        <h2 className="visually-hidden">Provider</h2>

        {editing && <ProviderPanel mount="settings" />}

        {!editing && !connected && (
          <div className={styles.empty}>
            <p className="t-md">No provider connected. Pigeon's assistant is off.</p>
            <Button variant="primary" onClick={() => setEditing(true)}>
              Connect a provider
            </Button>
          </div>
        )}

        {!editing && connected && (
          <>
            <div className={styles.header}>
              <span className={styles.mark} aria-hidden="true">
                {label.slice(0, 1)}
              </span>
              <div className={styles.headerText}>
                <div className="t-base">{label}</div>
                <div className={cn('t-mono-sm', styles.headerMeta)}>
                  {provider.model} · {maskedKey(provider)}
                </div>
              </div>
              <span className={cn('t-xs', styles.pill, styles.pillConnected)}>
                <span className={styles.pillDot} aria-hidden="true" />
                Connected
              </span>
              <Button variant="secondary" size="sm" onClick={() => setEditing(true)}>
                Change
              </Button>
            </div>

            <dl className={styles.meta}>
              <div className={styles.metaRow}>
                <dt className={cn('t-sm', styles.metaLabel)}>Endpoint</dt>
                <dd className={cn('t-mono-sm', styles.metaValue)}>{endpointFor(provider)}</dd>
              </div>
              <div className={styles.metaRow}>
                <dt className={cn('t-sm', styles.metaLabel)}>Key stored</dt>
                <dd className={cn('t-mono-sm', styles.metaValue)}>
                  This browser · never sent to Pigeon
                </dd>
              </div>
              <div className={styles.metaRow}>
                <dt className={cn('t-sm', styles.metaLabel)}>Spend this month</dt>
                <dd className={cn('t-mono-sm', styles.metaValue)}>
                  {formatSpend(usage.spendUsd)} · {plural(usage.calls, 'call')}
                </dd>
              </div>
              <div className={styles.metaRow}>
                <dt className={cn('t-sm', styles.metaLabel)}>Last call</dt>
                <dd className={cn('t-mono-sm', styles.metaValue)}>
                  {usage.lastCallAt
                    ? `${relativeTime(usage.lastCallAt)} · ${usage.lastCallMs} ms`
                    : 'No calls yet'}
                </dd>
              </div>
            </dl>

            <div className={styles.actionRow}>
              <Button variant="secondary" size="sm" onClick={() => setEditing(true)}>
                Test connection
              </Button>
              <Button variant="secondary-destructive" size="sm" onClick={handleRemoveKey}>
                Remove key
              </Button>
              <span className={cn('t-mono-sm', styles.note)}>Stored in this browser only</span>
            </div>
          </>
        )}
      </section>

      <section className={styles.behaviourBlock}>
        <h2 className="visually-hidden">Behaviour</h2>
        {BEHAVIOUR_ROWS.map((row) => (
          <div className={styles.toggleRow} key={row.key}>
            <div className={styles.toggleText}>
              <span id={`behaviour-${row.key}`} className="t-base">
                {row.label}
              </span>
              <span className={cn('t-sm', styles.toggleDescription)}>{row.description}</span>
            </div>
            <Switch
              checked={behaviour[row.key]}
              onChange={(next) => handleToggle(row, next)}
              disabled={!connected}
              aria-labelledby={`behaviour-${row.key}`}
            />
          </div>
        ))}
        <p className={cn('t-sm', styles.footer)}>
          Pigeon never sends anything you haven't read. Every draft opens in the composer for you
          to edit.
        </p>
      </section>
    </SettingsPage>
  );
}
