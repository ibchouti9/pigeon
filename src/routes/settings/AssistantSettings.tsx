import { useState } from 'react';
import { SettingsPage } from '../../components/settings/SettingsPage';
import { Button } from '../../components/primitives/Button';
import { Switch } from '../../components/primitives/Field';
import { ProviderPanel } from '../../components/onboarding/ProviderPanel';
import { DEFAULT_BASE_URL, PROVIDER_LABELS, hasProvider, type BehaviourFlags, type ConnectionStatus, type ProviderConfig, useSettings } from '../../store/settings';
import { testConnection } from '../../ai/client';
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
/** §7.6's rows for a failed connection test, by status. */
function testFailureCopy(status: string, providerName: string, baseUrl: string): string {
  switch (status) {
    case 'rejected':
      return `${providerName} rejected this key. Check it in your provider dashboard and paste it again.`;
    case 'no-credit':
      return `${providerName} returned no credit on this account. Top up, or switch provider.`;
    case 'unreachable':
      return `Nothing is answering at ${baseUrl}. Start your local model, then test again.`;
    default:
      return `Couldn't reach ${providerName}. Check your connection and test again.`;
  }
}

/** §5.13c / §7.8 — the pill's three states, and the fill each one carries. */
const PILLS: Record<ConnectionStatus, { label: string; className: string }> = {
  connected: { label: 'Connected', className: 'pillConnected' },
  unknown: { label: 'Not connected', className: 'pillUnknown' },
  rejected: { label: 'Key rejected', className: 'pillRejected' },
};

export function AssistantSettings() {
  const provider = useSettings((s) => s.provider);
  const connection = useSettings((s) => s.connection);
  const usage = useSettings((s) => s.usage);
  const behaviour = useSettings((s) => s.behaviour);
  const setBehaviour = useSettings((s) => s.setBehaviour);
  const setProvider = useSettings((s) => s.setProvider);
  const removeKey = useSettings((s) => s.removeKey);

  /** "Change" reopens the shared O2 form inline. */
  const [editing, setEditing] = useState(false);
  const [testing, setTesting] = useState(false);

  const connected = hasProvider(provider);
  const label = PROVIDER_LABELS[provider.provider];

  /**
   * §5.13c's action row means what it says. This used to call setEditing(true),
   * which swapped in the O2 form and left the actual test one more click away —
   * a button labelled "Test connection" that tested nothing.
   */
  async function handleTestConnection() {
    if (testing) return;
    setTesting(true);
    try {
      const result = await testConnection(provider);
      if (result.ok) {
        useSettings.getState().setConnection('connected');
        toast.confirm(`Connected. Answered in ${result.ms} ms.`);
      } else {
        useSettings.getState().setConnection(result.status === 'rejected' ? 'rejected' : 'unknown');
        toast.error(testFailureCopy(result.status, label, provider.baseUrl), {
          label: 'Change',
          run: () => setEditing(true),
        });
      }
    } catch {
      useSettings.getState().setConnection('unknown');
      toast.error(`Couldn't reach ${label}. Check your connection and test again.`);
    } finally {
      setTesting(false);
    }
  }

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

        {editing && (
          <ProviderPanel
            mount="settings"
            onSaved={() => setEditing(false)}
            onCancel={() => setEditing(false)}
          />
        )}

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
              {/*
                §5.13c gives this pill three states. It only ever rendered
                "Connected", gated on whether a key string was present rather
                than on whether it worked — so a revoked or out-of-credit key
                showed green while every AI surface silently failed. The test
                result was already being written to the store; nothing read it.
              */}
              <span className={cn('t-xs', styles.pill, styles[PILLS[connection].className])}>
                <span className={styles.pillDot} aria-hidden="true" />
                {PILLS[connection].label}
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
              <Button
                variant="secondary"
                size="sm"
                loading={testing}
                onClick={handleTestConnection}
              >
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
