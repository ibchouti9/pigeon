import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { SettingsPage } from '../../components/settings/SettingsPage';
import { useVirtualRows } from '../../components/settings/useVirtualRows';
import { Tabs } from '../../components/primitives/Controls';
import { Button } from '../../components/primitives/Button';
import { Monogram } from '../../components/primitives/Monogram';
import { Postmark } from '../../components/primitives/Postmark';
import { EmptyState, SkeletonRows } from '../../components/primitives/Feedback';
import { Icon } from '../../components/primitives/Icon';
import { useMail } from '../../store/mail';
import { cn } from '../../lib/cn';
import type { Sender } from '../../types';
import styles from './SendersSettings.module.css';

type Tab = 'approved' | 'declined';

/** §5.13b row height. */
const ROW_HEIGHT = 56;
const PANEL_ID = 'senders-panel';

function sortByDecidedDesc(list: Sender[]): Sender[] {
  return [...list].sort((a, b) => (b.decidedAt ?? '').localeCompare(a.decidedAt ?? ''));
}

/** §5.13b Senders — reverse any screening decision (§3.6). */
export function SendersSettings() {
  const approved = useMail((s) => s.approved);
  const declined = useMail((s) => s.declined);
  const status = useMail((s) => s.status.senders);
  const loadSenders = useMail((s) => s.loadSenders);
  const reverse = useMail((s) => s.reverse);
  const navigate = useNavigate();

  const [tab, setTab] = useState<Tab>('approved');
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (status === 'idle') void loadSenders();
  }, [status, loadSenders]);

  const list = tab === 'approved' ? approved : declined;

  // The filter narrows what's shown; it never touches the tab counts, which
  // always reflect the full approved/declined lists (§3.6 step 2).
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const base = q
      ? list.filter(
          (s) => s.name.toLowerCase().includes(q) || s.email.toLowerCase().includes(q),
        )
      : list;
    return sortByDecidedDesc(base);
  }, [list, query]);

  const { containerRef, startIndex, endIndex, topPad, bottomPad } = useVirtualRows(
    filtered.length,
    ROW_HEIGHT,
  );
  const visible = filtered.slice(startIndex, endIndex);

  return (
    <SettingsPage noScroll>
      <h1 className="t-xl">Senders</h1>

      <div className={styles.toolbar}>
        <Tabs
          label="Senders"
          value={tab}
          onChange={setTab}
          tabs={[
            { value: 'approved', label: `Approved (${approved.length})`, panelId: PANEL_ID },
            { value: 'declined', label: `Declined (${declined.length})`, panelId: PANEL_ID },
          ]}
        />
        <div className={styles.filter}>
          <Icon name="search" size={16} className={styles.filterIcon} />
          <input
            type="search"
            className={cn('t-base', styles.filterInput)}
            placeholder="Filter senders"
            aria-label="Filter senders"
            value={query}
            onChange={(e) => setQuery(e.currentTarget.value)}
          />
        </div>
      </div>

      <div id={PANEL_ID} role="tabpanel" aria-labelledby={`tab-${tab}`} className={styles.panel}>
        {status === 'loading' && (
          <SkeletonRows count={6} height={ROW_HEIGHT} circle={24} label="Loading senders" />
        )}

        {status === 'error' && (
          <EmptyState
            body="Pigeon couldn't load your senders. Try again."
            action={
              <Button variant="secondary" onClick={() => void loadSenders()}>
                Try again
              </Button>
            }
          />
        )}

        {status === 'ready' && list.length === 0 && tab === 'approved' && (
          <EmptyState
            body="No approved senders yet. Anyone you approve in the Screener shows up here, with the date you approved them."
            action={
              <Button variant="secondary" onClick={() => navigate('/screener')}>
                Open Screener
              </Button>
            }
          />
        )}

        {status === 'ready' && list.length === 0 && tab === 'declined' && (
          <EmptyState body="No declined senders. When you decline someone in the Screener, they show up here — and you can let them back in any time." />
        )}

        {status === 'ready' && list.length > 0 && (
          <div ref={containerRef} className={styles.list}>
            <div style={{ height: topPad }} aria-hidden="true" />
            {visible.map((sender) => (
              <div
                key={sender.id}
                data-testid={`sender-row-${sender.id}`}
                className={styles.row}
                style={{ height: ROW_HEIGHT }}
              >
                <Monogram name={sender.name} email={sender.email} size={24} />
                <div className={styles.rowText}>
                  <div className={styles.line1}>
                    <span className={cn('t-base', 'truncate', styles.name)}>{sender.name}</span>
                    <span className={cn('t-sm', 'truncate', styles.address)}>{sender.email}</span>
                  </div>
                  <Postmark
                    verb={tab === 'approved' ? 'Approved' : 'Declined'}
                    date={sender.decidedAt ?? new Date().toISOString()}
                    textOnly
                  />
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  className={styles.actionButton}
                  onClick={() =>
                    void reverse(sender.id, tab === 'approved' ? 'declined' : 'approved')
                  }
                >
                  {tab === 'approved' ? 'Decline' : 'Approve'}
                </Button>
              </div>
            ))}
            {filtered.length === 0 && (
              <p className={cn('t-sm', styles.noMatches)}>No senders match “{query}”.</p>
            )}
            <div style={{ height: bottomPad }} aria-hidden="true" />
          </div>
        )}
      </div>
    </SettingsPage>
  );
}
