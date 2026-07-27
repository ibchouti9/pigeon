import { useEffect, useRef, useState } from 'react';
import { useMail, type LoadStatus } from '../../store/mail';
import { shortcutsBlocked } from '../../store/ui';
import { useMinimumVisible } from '../../hooks/useMinimumVisible';
import { cn } from '../../lib/cn';
import { displayName, formatCount, plural } from '../../lib/format';
import type { HeldSender } from '../../types';
import type { TriageView } from '../../ai/useTriage';
import { Checkbox } from '../primitives/Field';
import { Button } from '../primitives/Button';
import { Monogram } from '../primitives/Monogram';
import { Postmark } from '../primitives/Postmark';
import { Icon } from '../primitives/Icon';
import { SkeletonRows } from '../primitives/Feedback';
import { MOTION, prefersReducedMotion } from './motion';
import styles from './BulkReview.module.css';

export interface BulkReviewProps {
  held: HeldSender[];
  status: LoadStatus;
  /** What Pigeon would do with each sender. A selection, never an action. */
  triage: TriageView;
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
/**
 * §4.2 renders postmark text at `S * 0.115`, and §8.5 item 10 puts the floor at
 * 11px. 11 / 0.115 = 95.7, so 96 is the smallest mark whose verb is legible.
 */
const POSTMARK_SIZE = 96;

export function BulkReview({
  held,
  status,
  triage,
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
  const rowRefs = useRef(new Map<string, HTMLDivElement>());
  // C-21 — 200ms minimum, so a fast load doesn't flash skeleton rows.
  const showSkeleton = useMinimumVisible(status !== 'ready');
  const snapshot = useRef<Map<string, HeldSender>>(new Map());
  const actingRef = useRef<Acting | null>(null);
  const mounted = useRef(true);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  actingRef.current = acting;

  useEffect(() => {
    if (!acting) setDisplayIds(held.map((h) => h.sender.id));
  }, [held, acting]);

  /*
   * One sentence per row, from one source.
   *
   * The read and the suggestion used to be two independent model calls, and
   * they contradicted each other on screen: a row reading "A warm intro from
   * Talia Brooks, who you email often" sat checked inside a selection labelled
   * "decline 5". Whatever else that is, it is not a product anyone would trust
   * to touch their mail. The evidence behind the suggestion is now the row's
   * text, so the two cannot disagree — and it is one call rather than two.
   */
  function rowRead(id: string): string | undefined {
    return triage.verdicts.get(id)?.why;
  }

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

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      timers.current.forEach(clearTimeout);
      timers.current = [];
    };
  }, []);

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

    // Switching back to Stack mid-animation unmounts this; the timers below
    // outlive it otherwise and set state on a component that is gone.
    timers.current.push(
      setTimeout(() => {
        setActing((a) => (a ? { ...a, phase: 'collapse' } : a));
      }, stampMs),
    );

    void decideMany(ids, decision).then(({ failed: failedIds }) => {
      timers.current.push(setTimeout(
        () => {
          if (!mounted.current) return;
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
      ));
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
    setCursorTo(displayIds[next]);
  }

  /** §8.1 Shift+J/K — move the cursor and pull the selection along with it. */
  function extendCursor(dir: 1 | -1) {
    if (!displayIds.length) return;
    const idx = cursorId ? displayIds.indexOf(cursorId) : -1;
    const next = idx === -1 ? 0 : Math.min(displayIds.length - 1, Math.max(0, idx + dir));
    const id = displayIds[next];
    if (!id) return;

    const selection = new Set(checked);
    if (cursorId) selection.add(cursorId);
    selection.add(id);
    onCheckedChange(selection);
    if (!anchorId) setAnchorId(cursorId ?? id);
    setCursorTo(id);
  }

  /** Moving the cursor past the fold has to bring it into view with it. */
  function setCursorTo(id: string | undefined) {
    if (!id) return;
    setCursorId(id);
    rowRefs.current
      .get(id)
      ?.scrollIntoView({ block: 'nearest', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
  }

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (shortcutsBlocked(e)) return;

      // §8.1 — Shift+J / Shift+K extend the selection through the list, the
      // keyboard equivalent of the Shift-click the rows already support.
      if (e.shiftKey && (e.key === 'J' || e.key === 'K')) {
        extendCursor(e.key === 'J' ? 1 : -1);
        e.preventDefault();
        return;
      }

      switch (e.key) {
        case 'j':
        case 'ArrowDown':
          moveCursor(1);
          e.preventDefault();
          break;
        case 'k':
        case 'ArrowUp':
          moveCursor(-1);
          e.preventDefault();
          break;
        case 'Home':
          setCursorTo(displayIds[0]);
          e.preventDefault();
          break;
        case 'End':
          setCursorTo(displayIds[displayIds.length - 1]);
          e.preventDefault();
          break;
        case 'Enter':
        case 'o':
          if (cursorId) onOpenSheet(cursorId);
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
          // §8.1's Esc is a layer stack. The global handler preventDefaults
          // when it minimizes the composer; without this the selection went
          // with it on the same press.
          if (e.defaultPrevented) return;
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

  if (showSkeleton) {
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
              ref={(el) => {
                if (el) rowRefs.current.set(id, el);
                else rowRefs.current.delete(id);
              }}
              className={cn(
                styles.row,
                isActing && acting?.phase === 'collapse' && styles.collapsing,
                isFailed && styles.failed,
                cursorId === id && styles.cursor,
              )}
              style={isActing ? ({ '--stagger': `${index * 30}ms` } as React.CSSProperties) : undefined}
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
                {rowRead(id) && (
                  <span className={cn('t-xs', styles.aiRead)}>
                    {/*
                      §4.7 requires all three of tint/label, ◆ glyph and a
                      visually hidden prefix. §5.8 gives this row the glyph
                      alone, which covers the first two — but the prefix is
                      unqualified, and without it the row's accessible name ran
                      the AI sentence straight on from the subject with nothing
                      marking where the machine started talking.
                    */}
                    <span className="visually-hidden">Pigeon&apos;s read of this sender: </span>
                    <span aria-hidden="true">◆ </span>
                    {rowRead(id)}
                  </span>
                )}
              </button>

              {isActing && acting && (
                <span className={styles.stampOverlay} aria-hidden="true">
                  <Postmark
                    verb={acting.decision === 'approved' ? 'Approved' : 'Returned'}
                    date={new Date().toISOString()}
                    // §4.2 sizes postmark text at S * 0.115, so a 40px mark
                    // rendered "RETURNED" at 4.6px — an unreadable smudge, and
                    // under §8.5's 11px floor. 96 is the smallest S that clears
                    // it; the overlay covers the row, so the mark can be larger
                    // than the row is tall.
                    size={POSTMARK_SIZE}
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

      {/*
       * §8.4 — "the status region announces '9 selected' on selection change".
       * The count used to be announced by an `aria-live` on the visible text
       * inside the action bar, and the bar only exists once something is
       * selected: the region and its first content entered the DOM in the same
       * mutation, which is the case screen readers skip. So the announcement
       * that mattered most — 0 to 1, the one that says a selection has started
       * — was the one least likely to be heard, and clearing unmounted the
       * region rather than saying anything.
       *
       * Mounted for the life of the screen, like the stack view's own.
       */}
      <div role="status" aria-live="polite" className="visually-hidden">
        {/*
          The selection, not the decision. Once a bulk decision is running the
          selection is being consumed and §3.3 step 3's toast announces the
          outcome — so this used to re-say "9 selected" over the top of
          "Approved 9 senders", two live regions with one of them describing a
          state that had just ended.
        */}
        {!acting && checked.size > 0 ? plural(checked.size, 'selected', 'selected') : ''}
      </div>

      {activeCount > 0 && (
        <div className={styles.bar} role="region" aria-label="Bulk actions">
          <span className="t-sm" style={{ fontWeight: 500 }}>
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
