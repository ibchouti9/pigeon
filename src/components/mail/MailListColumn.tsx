import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  Fragment,
} from 'react';
import { cn } from '../../lib/cn';
import {
  displayName,
  formatCount,
  formatListTimestamp,
  plural,
  relativeTime,
} from '../../lib/format';
import type { Place, Thread } from '../../types';
import type { LoadStatus } from '../../store/mail';
import { useUi } from '../../store/ui';
import { useCompose } from '../../store/compose';
import { shortcutsBlocked } from '../../store/ui';
import { Button } from '../primitives/Button';
import { EmptyState, SkeletonRows } from '../primitives/Feedback';
import { groupThreadsByDate } from './grouping';
import { ThreadRow } from './ThreadRow';
import { RevokedState } from './RevokedState';
import styles from './MailListColumn.module.css';

/** Matches --duration-base; reduced motion shortens the CSS, not this. */
const DEPART_MS = 180;

export interface MailListColumnHandle {
  focusThread: (id: string) => void;
}

export interface MailListColumnProps {
  place: Place;
  title: string;
  threads: Thread[];
  status: LoadStatus;
  online: boolean;
  revoked: boolean;
  openThreadId?: string;
  heldCount: number;
  /** Unread thread count — Inbox only; Archive never shows a count (§5.10). */
  unreadCount?: number;
  /** Inbox only — distinguishes "day one" from "cleared" empty copy. */
  hasArchivedAny?: boolean;
  onOpenThread: (id: string) => void;
  onArchiveThread: (id: string) => void;
  onArchiveMany: (ids: string[]) => void;
  onCursorChange?: (id: string | null) => void;
  onOpenScreener: () => void;
  onSendTest: () => void;
  onRetry: () => void;
  onConnectGmail: () => void;
  /** Narrow tablet (720–879px) — the list is the whole single column. */
  fullWidth?: boolean;
}

/**
 * §5.5 / §5.10 — the list column: sticky header, sticky date groups, rows.
 * Owns keyboard cursor + checkbox selection; archive/open decisions are
 * delegated to the parent so it can coordinate with the open reader.
 */
export const MailListColumn = forwardRef<MailListColumnHandle, MailListColumnProps>(
  function MailListColumn(
    {
      place,
      title,
      threads,
      status,
      online,
      revoked,
      openThreadId,
      heldCount,
      unreadCount,
      hasArchivedAny,
      onOpenThread,
      onArchiveThread,
      onArchiveMany,
      onCursorChange,
      onOpenScreener,
      onSendTest,
      onRetry,
      onConnectGmail,
      fullWidth,
    },
    ref,
  ) {
    const [cursorIndex, setCursorIndex] = useState(0);

    // §4.6 ROW DEPART — hold the row on screen for one animation, then hand the
    // archive up. Without this the row vanishes between frames.
    const [departing, setDeparting] = useState<Set<string>>(() => new Set());
    const departTimers = useRef<ReturnType<typeof setTimeout>[]>([]);

    useEffect(
      () => () => {
        departTimers.current.forEach(clearTimeout);
      },
      [],
    );

    function archiveWithDeparture(id: string) {
      if (departing.has(id)) return;
      setDeparting((prev) => new Set(prev).add(id));
      departTimers.current.push(
        setTimeout(() => {
          onArchiveThread(id);
          setDeparting((prev) => {
            const next = new Set(prev);
            next.delete(id);
            return next;
          });
        }, DEPART_MS),
      );
    }
    const [checked, setChecked] = useState<Set<string>>(new Set());
    const buttonRefs = useRef(new Map<string, HTMLButtonElement>());

    useImperativeHandle(ref, () => ({
      focusThread(id) {
        buttonRefs.current.get(id)?.focus();
      },
    }));

    function setCursor(idx: number, focus: boolean) {
      const clamped = Math.min(threads.length - 1, Math.max(0, idx));
      setCursorIndex(clamped);
      const id = threads[clamped]?.id;
      if (!id) return;
      const btn = buttonRefs.current.get(id);
      // jsdom has no scrollIntoView implementation; guard for tests too.
      btn?.scrollIntoView?.({ block: 'nearest' });
      if (focus) btn?.focus();
    }

    // Keep the cursor in range as the list shrinks (e.g. after an archive).
    useEffect(() => {
      setCursorIndex((i) => Math.min(i, Math.max(0, threads.length - 1)));
    }, [threads.length]);

    // Follow external navigation (opening a thread moves the cursor to it).
    useEffect(() => {
      if (!openThreadId) return;
      const idx = threads.findIndex((t) => t.id === openThreadId);
      if (idx >= 0) setCursor(idx, false);
      // Only re-sync when the *open thread* changes, not on every list update —
      // the cursor is independent of the open thread once the user moves it.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [openThreadId]);

    useEffect(() => {
      onCursorChange?.(threads[cursorIndex]?.id ?? null);
    }, [cursorIndex, threads, onCursorChange]);

    useEffect(() => {
      function onKeyDown(e: KeyboardEvent) {
        if (shortcutsBlocked(e)) return;
        if (threads.length === 0) return;

        if (e.shiftKey && (e.key === 'J' || e.key.toLowerCase() === 'j')) {
          extend(1);
          e.preventDefault();
          return;
        }
        if (e.shiftKey && (e.key === 'K' || e.key.toLowerCase() === 'k')) {
          extend(-1);
          e.preventDefault();
          return;
        }

        switch (e.key) {
          case 'j':
          case 'ArrowDown':
            setCursor(cursorIndex + 1, true);
            e.preventDefault();
            break;
          case 'k':
          case 'ArrowUp':
            setCursor(cursorIndex - 1, true);
            e.preventDefault();
            break;
          case 'Enter':
          case 'o': {
            const t = threads[cursorIndex];
            if (t) onOpenThread(t.id);
            e.preventDefault();
            break;
          }
          case 'x': {
            const t = threads[cursorIndex];
            if (t) toggleCheck(t.id);
            e.preventDefault();
            break;
          }
          case 'Home':
            setCursor(0, true);
            e.preventDefault();
            break;
          case 'End':
            setCursor(threads.length - 1, true);
            e.preventDefault();
            break;
          case 'Escape': {
            if (checked.size === 0) return;
            // §8.1's Esc is a layer stack — one press closes one layer. The
            // global handler runs first and preventDefaults when it minimizes
            // the composer; without this check the list then saw an
            // already-minimized composer and cleared the selection as well, so
            // one Esc closed two layers.
            if (e.defaultPrevented) return;
            const ui = useUi.getState();
            const compose = useCompose.getState();
            if (
              ui.dialog ||
              ui.shortcutsOpen ||
              ui.heldSheetSenderId ||
              (compose.draft && !compose.minimized)
            ) {
              return;
            }
            setChecked(new Set());
            e.preventDefault();
            break;
          }
          default:
            break;
        }
      }

      function extend(delta: 1 | -1) {
        const current = threads[cursorIndex];
        if (current) setChecked((prev) => new Set(prev).add(current.id));
        const nextIdx = Math.min(threads.length - 1, Math.max(0, cursorIndex + delta));
        const next = threads[nextIdx];
        if (next) setChecked((prev) => new Set(prev).add(next.id));
        setCursor(nextIdx, true);
      }

      window.addEventListener('keydown', onKeyDown);
      return () => window.removeEventListener('keydown', onKeyDown);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [threads, cursorIndex, checked]);

    function toggleCheck(id: string) {
      setChecked((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
    }

    const groups = useMemo(
      () => groupThreadsByDate(threads, { archive: place === 'archive' }),
      [threads, place],
    );

    const ariaLabel =
      place === 'inbox' && unreadCount
        ? `${title}, ${formatCount(unreadCount)} unread`
        : title;

    const showCount = place === 'inbox' && Boolean(unreadCount);

    return (
      <div className={cn(styles.column, fullWidth && styles.fullWidth)}>
        <div className={styles.header}>
          {checked.size > 0 ? (
            <>
              <span className={cn('t-base', styles.bulkLabel)}>
                {formatCount(checked.size)} selected
              </span>
              <div className={styles.bulkActions}>
                <Button
                  variant="secondary"
                  size="sm"
                  aria-disabled={!online || undefined}
                  onClick={() => {
                    if (!online) return;
                    onArchiveMany(Array.from(checked));
                    setChecked(new Set());
                  }}
                >
                  {place === 'inbox' ? 'Archive' : 'Move to inbox'}
                </Button>
                <Button variant="tertiary" size="sm" onClick={() => setChecked(new Set())}>
                  Clear
                </Button>
              </div>
            </>
          ) : (
            <>
              <h1 className={cn('t-display-sm', styles.title)}>{title}</h1>
              {showCount && (
                <span className={cn('t-mono-sm', styles.count)}>
                  {formatCount(unreadCount ?? 0)}
                </span>
              )}
            </>
          )}
        </div>

        {revoked ? (
          <RevokedState onConnectGmail={onConnectGmail} />
        ) : status === 'error' ? (
          <UnreachableState onRetry={onRetry} />
        ) : status === 'loading' || status === 'idle' ? (
          <div className={styles.scroll}>
            <SkeletonRows count={8} label={`Loading ${title.toLowerCase()}`} />
          </div>
        ) : threads.length === 0 ? (
          <EmptyListState
            place={place}
            heldCount={heldCount}
            hasArchivedAny={Boolean(hasArchivedAny)}
            onOpenScreener={onOpenScreener}
            onSendTest={onSendTest}
          />
        ) : (
          <div className={styles.scroll}>
            <div role="list" aria-label={ariaLabel} className={styles.list}>
              {(() => {
                let rowIndex = -1;
                return groups.map((group) => (
                  <Fragment key={group.label}>
                    <div className={cn('t-mono-sm', styles.groupHeader)} aria-hidden="true">
                      {group.label}
                    </div>
                    {group.threads.map((t) => {
                      rowIndex += 1;
                      const idx = rowIndex;
                      const last = t.messages[t.messages.length - 1];
                      const senderAddr = last?.isFromUser
                        ? (t.messages.find((m) => !m.isFromUser)?.from ?? last.from)
                        : (last?.from ?? { name: '', email: '' });
                      const snippet = last?.body.slice(0, 140).replace(/\s+/g, ' ').trim() ?? '';
                      return (
                        <ThreadRow
                          key={t.id}
                          sender={displayName(senderAddr)}
                          senderEmail={senderAddr.email}
                          subject={t.subject}
                          snippet={snippet}
                          timestamp={formatListTimestamp(t.lastMessageAt)}
                          timestampSpoken={relativeTime(t.lastMessageAt)}
                          unread={t.unread}
                          messageCount={t.messages.length}
                          hasAttachment={t.messages.some((m) => m.attachments.length > 0)}
                          isNewlyApproved={Boolean(t.approvedAt)}
                          checked={checked.has(t.id)}
                          cursor={idx === cursorIndex}
                          open={t.id === openThreadId}
                          place={place}
                          online={online}
                          tabIndex={idx === cursorIndex ? 0 : -1}
                          onOpen={() => {
                            setCursor(idx, false);
                            onOpenThread(t.id);
                          }}
                          onToggleCheck={() => toggleCheck(t.id)}
                          departing={departing.has(t.id)}
                          onArchive={() => archiveWithDeparture(t.id)}
                          buttonRef={(el) => {
                            if (el) buttonRefs.current.set(t.id, el);
                            else buttonRefs.current.delete(t.id);
                          }}
                        />
                      );
                    })}
                  </Fragment>
                ));
              })()}
            </div>
          </div>
        )}
      </div>
    );
  },
);

function UnreachableState({ onRetry }: { onRetry: () => void }) {
  return (
    <div className={styles.stateBlock}>
      <p className="t-lg">Pigeon can't reach Gmail.</p>
      <p className={cn('t-sm', styles.stateBody)}>
        Your mail is safe. This is a connection problem between Pigeon and Google.
      </p>
      <Button variant="primary" onClick={onRetry}>
        Try again
      </Button>
      <a
        className={cn('t-sm', styles.stateLink)}
        href="https://www.google.com/appsstatus/dashboard/"
        target="_blank"
        rel="noreferrer"
      >
        Check Google Workspace status
      </a>
    </div>
  );
}

function EmptyListState({
  place,
  heldCount,
  hasArchivedAny,
  onOpenScreener,
  onSendTest,
}: {
  place: Place;
  heldCount: number;
  hasArchivedAny: boolean;
  onOpenScreener: () => void;
  onSendTest: () => void;
}) {
  if (place === 'archive') {
    return (
      <EmptyState
        headline="Nothing archived yet."
        body="Threads you archive from your inbox end up here. Nothing is ever deleted."
      />
    );
  }

  const cleared = hasArchivedAny;

  if (cleared) {
    return (
      <EmptyState
        headline="Nothing left."
        body={
          heldCount > 0
            ? // §7.4's row is written at 7 senders. The verb has to follow the
              // count, or one waiting sender reads "1 sender are waiting".
              `You've read everything. ${plural(heldCount, 'sender')} ${heldCount === 1 ? 'is' : 'are'} waiting in the Screener.`
            : "You've read everything."
        }
        action={
          heldCount > 0 ? (
            <Button variant="primary" onClick={onOpenScreener}>
              Open Screener
            </Button>
          ) : undefined
        }
      />
    );
  }

  return (
    <EmptyState
      headline="Your inbox is empty."
      body={
        heldCount > 0
          ? `Mail from your approved senders lands here. Pigeon is holding ${plural(heldCount, 'sender')} in the Screener — start there.`
          : 'Mail from your approved senders lands here. Nothing has arrived yet.'
      }
      action={
        heldCount > 0 ? (
          <Button variant="primary" onClick={onOpenScreener}>
            Open Screener
          </Button>
        ) : (
          <Button variant="tertiary" onClick={onSendTest}>
            Send yourself a test
          </Button>
        )
      }
    />
  );
}
