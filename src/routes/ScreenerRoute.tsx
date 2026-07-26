import { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useMail } from '../store/mail';
import { useUi } from '../store/ui';
import { useOnline } from '../hooks/useOnline';
import { cn } from '../lib/cn';
import { Segmented } from '../components/primitives/Controls';
import { Button } from '../components/primitives/Button';
import { EmptyState } from '../components/primitives/Feedback';
import { ScreenerDigest } from '../components/screener/ScreenerDigest';
import { CardStack } from '../components/screener/CardStack';
import { BulkReview } from '../components/screener/BulkReview';
import { HeldMessageSheet } from '../components/screener/HeldMessageSheet';
import { useScreenerAi } from '../ai/useScreenerAi';
import { useAssistant, useBehaviour } from '../ai/useAssistant';
import styles from './ScreenerRoute.module.css';

type View = 'stack' | 'list';

/**
 * §5.7/§5.8/§5.9 — the Screener. No list column: the region from the rail's
 * right edge to the window edge is one screen. `?view=list` drives Stack vs
 * Bulk review; `/screener/s/:senderId` opens the held-message sheet without
 * unmounting whichever view is behind it.
 */
export function ScreenerRoute() {
  const navigate = useNavigate();
  const { senderId } = useParams<{ senderId?: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const view: View = searchParams.get('view') === 'list' ? 'list' : 'stack';

  const held = useMail((s) => s.held);
  const status = useMail((s) => s.status.held);
  const loadHeld = useMail((s) => s.loadHeld);
  const online = useOnline();

  const heldSheetSenderId = useUi((s) => s.heldSheetSenderId);
  const openHeldSheet = useUi((s) => s.openHeldSheet);
  const closeHeldSheet = useUi((s) => s.closeHeldSheet);

  const [checked, setChecked] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (status === 'idle') void loadHeld();
  }, [status, loadHeld]);

  // URL -> sheet store (direct links, and opening a card/row).
  useEffect(() => {
    if (senderId) openHeldSheet(senderId);
    else closeHeldSheet();
    // openHeldSheet/closeHeldSheet are stable zustand actions.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [senderId]);

  // Sheet store -> URL — Esc and the close button only clear the store; fix
  // up the URL to match so the sheet truly reads as an overlay, not a page.
  useEffect(() => {
    if (!heldSheetSenderId && senderId) {
      const search = searchParams.toString();
      navigate(`/screener${search ? `?${search}` : ''}`, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [heldSheetSenderId]);

  // §5.8 — Bulk review jumps back to Stack when it empties.
  //
  // Deliberately delayed. A bulk decision removes every selected row
  // optimistically, so declining all of them takes `held` to zero for a moment
  // even when some fail and come back. Switching views on that transient
  // reading yanked the list out from under the user mid-action.
  useEffect(() => {
    if (!(status === 'ready' && held.length === 0 && view === 'list')) return;
    const timer = setTimeout(() => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.delete('view');
          return next;
        },
        { replace: true },
      );
    }, 400);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, held.length, view]);

  const { digest, digestState, retryDigest, reads } = useScreenerAi();
  const { connected } = useAssistant();
  const { screenerReads } = useBehaviour();

  function setView(next: View) {
    const params = new URLSearchParams(searchParams);
    if (next === 'list') params.set('view', 'list');
    else params.delete('view');
    setSearchParams(params);
  }

  function openSheet(id: string) {
    // Carry the whole query string, not just `view` — rebuilding it here drops
    // anything else the URL is holding.
    const search = searchParams.toString();
    navigate(`/screener/s/${id}${search ? `?${search}` : ''}`);
  }

  function selectGroup(senderIds: string[]) {
    setChecked(new Set(senderIds));
    setView('list');
  }

  const isEmpty = status === 'ready' && held.length === 0;

  return (
    <div className={styles.region}>
      <header className={styles.header}>
        <h1 className={cn('t-display-sm', styles.title)}>Screener</h1>
        <Segmented
          as="tablist"
          label="Screener view"
          value={view}
          onChange={setView}
          options={[
            { value: 'stack', label: 'Stack' },
            { value: 'list', label: 'Bulk review' },
          ]}
        />
      </header>

      <div className={styles.content}>
        {status === 'error' && (
          <div className={styles.centered}>
            <EmptyState
              headline="Pigeon can't reach Gmail."
              body="Your mail is safe. This is a connection problem between Pigeon and Google."
              // §5.7 says "same copy as the inbox", and §5.5 specifies that
              // state as a *primary* Try again plus the status link.
              action={
                <Button variant="primary" onClick={() => void loadHeld()}>
                  Try again
                </Button>
              }
              secondaryAction={
                <a
                  className="t-sm"
                  href="https://www.google.com/appsstatus/dashboard/"
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  Check Google Workspace status
                </a>
              }
            />
          </div>
        )}

        {status !== 'error' && isEmpty && (
          <div className={styles.centered}>
            <EmptyState
              visual="blank-card"
              headline="Nothing waiting."
              body="New senders will appear here. You'll never miss them — they just don't interrupt you."
              action={
                <Button variant="tertiary" onClick={() => navigate('/settings/senders')}>
                  See who you've approved
                </Button>
              }
            />
          </div>
        )}

        {status !== 'error' && !isEmpty && (
          <>
            <ScreenerDigest
              heldCount={held.length}
              digest={digest ?? undefined}
              state={digestState === 'idle' ? 'loading' : digestState}
              hasProvider={connected}
              readsEnabled={screenerReads}
              onRetry={retryDigest}
              onSelectGroup={selectGroup}
            />

            {view === 'stack' ? (
              <div key="stack" className={styles.view}>
                <CardStack
                  held={held}
                  status={status}
                  reads={reads}
                  online={online}
                  onRead={openSheet}
                  onToggleView={() => setView('list')}
                />
              </div>
            ) : (
              <div key="list" className={styles.view}>
                <BulkReview
                  held={held}
                  status={status}
                  reads={reads}
                  online={online}
                  checked={checked}
                  onCheckedChange={setChecked}
                  onToggleView={() => setView('stack')}
                  onOpenSheet={openSheet}
                />
              </div>
            )}
          </>
        )}
      </div>

      <HeldMessageSheet />
    </div>
  );
}
