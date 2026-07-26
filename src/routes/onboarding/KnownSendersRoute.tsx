import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { OnboardingColumn } from '../../components/onboarding/OnboardingColumn';
import { useVirtualList } from '../../components/onboarding/useVirtualList';
import { Button } from '../../components/primitives/Button';
import { Checkbox, Input } from '../../components/primitives/Field';
import { Icon } from '../../components/primitives/Icon';
import { Monogram } from '../../components/primitives/Monogram';
import { SkeletonRows } from '../../components/primitives/Feedback';
import { cn } from '../../lib/cn';
import { formatCount, plural } from '../../lib/format';
import { MailError } from '../../data/provider';
import { useMail } from '../../store/mail';
import { useMinimumVisible } from '../../hooks/useMinimumVisible';
import type { Sender } from '../../types';
import styles from './KnownSendersRoute.module.css';

/** Mirrors --layout-row-height-dense (44px), needed as a number for the
 * virtualization math (§5.3). */
const ROW_HEIGHT = 44;

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function reasonText(sender: Sender): string {
  if (sender.knownReason === 'contact') return 'Contact';
  return plural(sender.replyCount ?? 0, 'reply', 'replies');
}

type LoadStatus = 'loading' | 'ready' | 'error';

export function KnownSendersRoute() {
  const navigate = useNavigate();

  const [status, setStatus] = useState<LoadStatus>('loading');
  // C-21 — 200ms minimum on the skeleton.
  const showSkeleton = useMinimumVisible(status === 'loading');
  const [errorText, setErrorText] = useState(
    "Pigeon couldn't read your contacts. You can approve senders one at a time in the Screener instead.",
  );
  const [senders, setSenders] = useState<Sender[]>([]);
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState('');
  const [cursorIndex, setCursorIndex] = useState(0);
  const [anchorIndex, setAnchorIndex] = useState<number | null>(null);
  const [rangeTarget, setRangeTarget] = useState<boolean | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const filterRef = useRef<HTMLInputElement>(null);

  async function load() {
    setStatus('loading');
    try {
      const known = await useMail.getState().provider.getKnownSenders();
      setSenders(known);
      setTicked(new Set(known.map((s) => s.id)));
      setStatus('ready');
    } catch (error) {
      /*
       * `getKnownSenders` can now fail for more than one reason — a contacts
       * read that Google refused, a revoked token, an unreachable Gmail — and
       * each carries its own §7.6 line. Showing the contacts copy for all of
       * them would tell a user with an expired token to try their address book
       * again. Both actions still fit either way: try again, or continue and
       * approve people one at a time in the Screener.
       */
      setErrorText(
        error instanceof MailError
          ? error.message
          : "Pigeon couldn't read your contacts. You can approve senders one at a time in the Screener instead.",
      );
      setStatus('error');
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return senders;
    return senders.filter(
      (s) => s.name.toLowerCase().includes(q) || s.email.toLowerCase().includes(q),
    );
  }, [senders, filter]);

  const virtual = useVirtualList(filtered.length, ROW_HEIGHT);
  const visible = filtered.slice(virtual.startIndex, virtual.endIndex);

  function onFilterChange(v: string) {
    setFilter(v);
    setCursorIndex(0);
    setAnchorIndex(null);
    setRangeTarget(null);
  }

  function toggleSender(id: string) {
    setTicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleUntickAll() {
    setTicked(ticked.size === 0 ? new Set(senders.map((s) => s.id)) : new Set());
  }

  function scrollRowIntoView(index: number) {
    const el = virtual.containerRef.current;
    if (!el) return;
    const top = index * ROW_HEIGHT;
    const bottom = top + ROW_HEIGHT;
    if (top < el.scrollTop) el.scrollTop = top;
    else if (bottom > el.scrollTop + el.clientHeight) el.scrollTop = bottom - el.clientHeight;
  }

  function onListKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (filtered.length === 0) return;

    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const dir = e.key === 'ArrowDown' ? 1 : -1;
      const next = clamp(cursorIndex + dir, 0, filtered.length - 1);

      if (e.shiftKey) {
        // §5.3 — "Shift+↑/↓ extends a toggle range". It used to need a Space
        // first, because only Space set the anchor; arrowing to a row and
        // holding Shift just moved the cursor. Shift starts its own range from
        // wherever the cursor is, and extends by ticking, which is what Shift
        // does everywhere else in the product.
        const anchor = anchorIndex ?? cursorIndex;
        const target = rangeTarget ?? true;
        if (anchorIndex === null) setAnchorIndex(anchor);
        if (rangeTarget === null) setRangeTarget(target);

        const lo = Math.min(anchor, next);
        const hi = Math.max(anchor, next);
        setTicked((prev) => {
          const copy = new Set(prev);
          for (let i = lo; i <= hi; i++) {
            const id = filtered[i]?.id;
            if (!id) continue;
            if (target) copy.add(id);
            else copy.delete(id);
          }
          return copy;
        });
      } else if (!e.shiftKey) {
        setAnchorIndex(null);
        setRangeTarget(null);
      }

      setCursorIndex(next);
      scrollRowIntoView(next);
      return;
    }

    if (e.key === ' ') {
      e.preventDefault();
      const id = filtered[cursorIndex]?.id;
      if (!id) return;
      const wasTicked = ticked.has(id);
      toggleSender(id);
      setAnchorIndex(cursorIndex);
      setRangeTarget(!wasTicked);
      return;
    }

    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      filterRef.current?.focus();
    }
  }

  async function handleApprove() {
    setSubmitting(true);
    try {
      await useMail.getState().provider.approveKnownSenders(Array.from(ticked));
      navigate('/setup/screener');
    } finally {
      setSubmitting(false);
    }
  }

  const approveLabel =
    ticked.size === 0 ? 'Continue with no approved senders' : `Approve ${formatCount(ticked.size)} senders`;

  return (
    <OnboardingColumn width={720}>
      <h1 className={cn('t-display-md', styles.heading)}>Who already knows you?</h1>

      {showSkeleton && <SkeletonRows count={8} height={44} circle={24} label="Loading known senders" />}

      {status === 'error' && (
        <div className={styles.stateBlock}>
          <p className="t-md ink-secondary">{errorText}</p>
          <div className={styles.stateActions}>
            <Button variant="secondary" onClick={load}>
              Try again
            </Button>
            <Button variant="primary" onClick={() => navigate('/setup/screener')}>
              Continue
            </Button>
          </div>
        </div>
      )}

      {status === 'ready' && senders.length < 3 && (
        <div className={styles.emptyBlock}>
          <p className="t-md ink-secondary">
            Pigeon didn&apos;t find anyone to propose. Everything new will start in the Screener
            until you approve someone.
          </p>
          <Button
            variant="primary"
            className={styles.emptyButton}
            onClick={() => navigate('/setup/screener')}
          >
            Continue
          </Button>
        </div>
      )}

      {status === 'ready' && senders.length >= 3 && (
        <>
          <p className={cn('t-md', 'ink-secondary', styles.body)}>
            {`These ${formatCount(senders.length)} people are in your contacts or you've written to them before. Their mail goes straight to your inbox. Everyone else starts in the Screener.`}
          </p>

          <div className={styles.toolbar}>
            <div className={styles.filterWrap}>
              <Icon name="search" size={16} className={styles.filterIcon} />
              <Input
                ref={filterRef}
                size="sm"
                placeholder="Find a sender"
                aria-label="Find a sender"
                value={filter}
                onChange={(e) => onFilterChange(e.target.value)}
                className={styles.filterInput}
              />
            </div>
            <Button variant="secondary" onClick={handleUntickAll}>
              {ticked.size === 0 ? 'Tick all' : 'Untick all'}
            </Button>
          </div>

          <div
            ref={virtual.containerRef}
            className={styles.listBox}
            tabIndex={0}
            role="group"
            aria-label="Known senders"
            onKeyDown={onListKeyDown}
          >
            <div style={{ height: virtual.topPad }} aria-hidden="true" />
            {visible.map((sender, i) => {
              const index = virtual.startIndex + i;
              const checked = ticked.has(sender.id);
              return (
                <label
                  key={sender.id}
                  className={cn(styles.row, index === cursorIndex && styles.rowCursor)}
                  style={{ height: ROW_HEIGHT }}
                >
                  <Checkbox
                    checked={checked}
                    onChange={() => toggleSender(sender.id)}
                    aria-label={sender.name || sender.email}
                  />
                  <Monogram name={sender.name} email={sender.email} size={24} />
                  <span className={cn('t-base', styles.name)}>{sender.name}</span>
                  <span className={cn('t-sm', 'ink-tertiary', styles.address)}>{sender.email}</span>
                  <span className={cn('t-xs', 'ink-tertiary', styles.reason)}>
                    {reasonText(sender)}
                  </span>
                </label>
              );
            })}
            <div style={{ height: virtual.bottomPad }} aria-hidden="true" />
          </div>

          {ticked.size === 0 && (
            <p className={cn('t-sm', 'ink-tertiary', styles.helper)}>
              Everything new will start in the Screener until you approve someone.
            </p>
          )}

          <Button
            variant="primary"
            fullWidth
            loading={submitting}
            onClick={handleApprove}
            className={styles.approveButton}
          >
            {approveLabel}
          </Button>
        </>
      )}
    </OnboardingColumn>
  );
}
