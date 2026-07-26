import { useEffect, useRef, useState } from 'react';
import { useMail, type LoadStatus } from '../../store/mail';
import { useUi, isTypingTarget } from '../../store/ui';
import { cn } from '../../lib/cn';
import { displayName, formatCount, plural } from '../../lib/format';
import type { HeldSender } from '../../types';
import { Checkbox } from '../primitives/Field';
import { Button } from '../primitives/Button';
import { Monogram } from '../primitives/Monogram';
import { Postmark } from '../primitives/Postmark';
import { Icon } from '../primitives/Icon';
import { SkeletonRows } from '../primitives/Feedback';
import { MOTION } from './motion';
import styles from './BulkReview.module.css';

export interface BulkReviewProps {
  held: HeldSender[];
  status: LoadStatus;
  hasProvider: boolean;
  online: boolean;
  checked: Set<string>;
  onCheckedChange: (next: Set<string>) => void;
  onToggleView: () => void;
  onOpenSheet: (senderId: string) => void;
}

interface Acting {
  ids: string[];
  decision: 'approved' | 'declined';
  phase: 'stamp' | 'collapse';
}

/**
 * §5.8 bulk review — select-all with indeterminate state, Shift+click range
 * extension, and the C-22 bulk action bar. Rows that are mid-decision keep
 * rendering from a local snapshot so the stamp + collapse animation (§3.3)
 * has something to animate before the store's optimistic removal takes over.
 */
export function BulkReview({
  held,
  status,
  hasProvider,
  online,
  checked,
  onCheckedChange,
  onToggleView,
  onOpenSheet,
}: BulkReviewProps) {
  const decideMany = useMail((s) => s.decideMany);

  const [displayIds, setDisplayIds] = useState<string[]>(() => held.map((h) => h.sender.id));
  const [cursorId, setCursorId] = useState<string | null>(null);
  const [anchorId, setAnchorId] = useState<string | null>(null);
  const [acting, setActing] = useState<Acting | null>(null);
  const [failed, setFailed] = useState<Map<string, 'approved' | 'declined'>>(new Map());
  const snapshot = useRef<Map<string, HeldSender>>(new Map());
  const actingRef = useRef<Acting | null>(null);
  actingRef.current = acting;

  useEffect(() => {
    if (!acting) setDisplayIds(held.map((h) => h.sender.id));
  }, [held, acting]);

  function rowFor(id: string): HeldSender | undefined {
    return held.find((h) => h.sender.id === id) ?? snapshot.current.get(id);
  }

  function toggleOne(id: string) {
    const next = new Set(checked);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onCheckedChange(next);
    setCursorId(id);
    setAnchorId(id);
  }

  function toggleRange(id: string) {
    if (!anchorId) return toggleOne(id);
    const a = displayIds.indexOf(anchorId);
    const b = displayIds.indexOf(id);
    if (a === -1 || b === -1) return toggleOne(id);
    const [lo, hi] = a < b ? [a, b] : [b, a];
    const next = new Set(checked);
    for (let i = lo; i <= hi; i++) next.add(displayIds[i]);
    onCheckedChange(next);
    setCursorId(id);
  }

  function toggleAll() {
    if (checked.size >= displayIds.length && displayIds.length > 0) onCheckedChange(new Set());
    else onCheckedChange(new Set(displayIds));
  }

  function runDecision(ids: string[], decision: 'approved' | 'declined') {
    if (!online || ids.length === 0 || actingRef.current) return;
    for (const id of ids) {
      const row = held.find((h) => h.sender.id === id);
      if (row) snapshot.current.set(id, row);
    }
    setActing({ ids, decision, phase: 'stamp' });
    setFailed((prev) => {
      const next = new Map(prev);
      ids.forEach((id) => next.delete(id));
      return next;
    });

    const stampMs = MOTION.stamp();
    const baseMs = MOTION.base();
    const staggerMs = ids.length * 30;

    window.setTimeout(() => {
      setActing((a) => (a ? { ...a, phase: 'collapse' } : a));
    }, stampMs);

    void decideMany(ids, decision).then(({ failed: failedIds }) => {
      window.setTimeout(
        () => {
          setActing(null);
          onCheckedChange(new Set());
          if (failedIds.length) {
            setFailed((prev) => {
              const next = new Map(prev);
              failedIds.forEach((id) => next.set(id, decision));
              return next;
            });
          }
        },
        stampMs + baseMs + staggerMs,
      );
    });
  }

  function act(decision: 'approved' | 'declined') {
    runDecision(
      displayIds.filter((id) => checked.has(id)),
      decision,
    );
  }

  function retryOne(id: string) {
    const decision = failed.get(id);
    if (decision) runDecision([id], decision);
  }

  function moveCursor(dir: 1 | -1) {
    if (!displayIds.length) return;
    const idx = cursorId ? displayIds.indexOf(cursorId) : -1;
    const next = idx === -1 ? 0 : Math.min(displayIds.length - 1, Math.max(0, idx + dir));
    setCursorId(displayIds[next]);
  }

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (isTypingTarget(e.target)) return;
      const ui = useUi.getState();
      if (ui.heldSheetSenderId || ui.dialog || ui.shortcutsOpen) return;
      switch (e.key) {
        case 'j':
          moveCursor(1);
          e.preventDefault();
          break;
        case 'k':
          moveCursor(-1);
          e.preventDefault();
          break;
        case 'x':
          if (online && cursorId) toggleOne(cursorId);
          e.preventDefault();
          break;
        case 'a':
          if (online) runDecision(checked.size ? displayIds.filter((id) => checked.has(id)) : cursorId ? [cursorId] : [], 'approved');
          e.preventDefault();
          break;
        case 'd':
          if (online) runDecision(checked.size ? displayIds.filter((id) => checked.has(id)) : cursorId ? [cursorId] : [], 'declined');
          e.preventDefault();
          break;
        case 'b':
          onToggleView();
          e.preventDefault();
          break;
        case 'Escape':
          onCheckedChange(new Set());
          break;
        default:
          break;
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [displayIds, checked, cursorId, online]);

  if (status !== 'ready') {
    return <SkeletonRows count={6} height={64} circle={28} label="Loading" />;
  }

  const allChecked = displayIds.length > 0 && checked.size >= displayIds.length;
  const someChecked = checked.size > 0 && !allChecked;
  const activeCount = acting ? acting.ids.length : checked.size;

  return (
    <>
      <div className={styles.container} role="list" aria-label="Held senders">
        <div className={styles.header}>
          <label className={styles.selectAllLabel}>
            <Checkbox
              checked={allChecked}
              indeterminate={someChecked}
              disabled={!online || displayIds.length === 0}
              onChange={toggleAll}
              aria-label={`Select all (${formatCount(displayIds.length)})`}
            />
            <span className="t-sm" style={{ fontWeight: 500 }}>
              Select all ({formatCount(displayIds.length)})
            </span>
          </label>
        </div>

        {displayIds.map((id, index) => {
          const row = rowFor(id);
          if (!row) return null;
          const isActing = acting?.ids.includes(id) ?? false;
          const isFailed = failed.has(id);
          const first = row.messages[0];

          return (
            <div
              key={id}
              role="listitem"
              className={cn(
                styles.row,
                isActing && acting?.phase === 'collapse' && styles.collapsing,
                isFailed && styles.failed,
                cursorId === id && styles.cursor,
              )}
              style={isActing ? { transitionDelay: `${index * 30}ms` } : undefined}
            >
              <span className={styles.checkboxCell} onClick={(e) => e.stopPropagation()}>
                <Checkbox
                  checked={checked.has(id)}
                  disabled={!online}
                  aria-label={`Select ${displayName(row.sender)}`}
                  onClick={(e) => {
                    if (e.shiftKey) {
                      e.preventDefault();
                      toggleRange(id);
                    }
                  }}
                  onChange={() => toggleOne(id)}
                />
              </span>
              <button type="button" className={styles.rowBody} onClick={() => onOpenSheet(id)}>
                <Monogram name={row.sender.name} email={row.sender.email} size={28} />
                <span className={cn('t-base', 'truncate', styles.name)}>{displayName(row.sender)}</span>
                <span className={cn('t-sm', 'truncate', styles.subject)}>{first.subject}</span>
                {hasProvider && row.aiRead && (
                  <span className={cn('t-xs', styles.aiRead)}>◆ {row.aiRead}</span>
                )}
              </button>

              {isActing && acting && (
                <span className={styles.stampOverlay} aria-hidden="true">
                  <Postmark
                    verb={acting.decision === 'approved' ? 'Approved' : 'Returned'}
                    date={new Date().toISOString()}
                    size={40}
                    ink={acting.decision === 'approved' ? 'accent' : 'destructive'}
                    decorative
                    animate
                  />
                </span>
              )}

              {isFailed && (
                <span className={styles.failedInline}>
                  <Icon name="warning" size={16} />
                  <button type="button" className="t-xs" onClick={() => retryOne(id)}>
                    Try again
                  </button>
                </span>
              )}
            </div>
          );
        })}
      </div>

      {activeCount > 0 && (
        <div className={styles.bar} role="region" aria-label="Bulk actions">
          <span className="t-sm" style={{ fontWeight: 500 }} aria-live="polite">
            {plural(activeCount, 'selected', 'selected')}
          </span>
          <div className={styles.spacer} />
          <Button
            variant="secondary-destructive"
            onClick={() => act('declined')}
            disabled={!online || Boolean(acting)}
            loading={Boolean(acting)}
          >
            Decline senders
          </Button>
          <Button
            variant="primary"
            onClick={() => act('approved')}
            disabled={!online || Boolean(acting)}
            loading={Boolean(acting)}
          >
            Approve senders
          </Button>
          <Button variant="tertiary" onClick={() => onCheckedChange(new Set())} disabled={Boolean(acting)}>
            Clear
          </Button>
        </div>
      )}
    </>
  );
}
