import { useEffect, useId, useRef } from 'react';
import { useMail } from '../../store/mail';
import { isTypingTarget, useUi } from '../../store/ui';
import { useOnline } from '../../hooks/useOnline';
import { cn } from '../../lib/cn';
import { displayName, formatBytes, formatMessageTimestamp, formatPostmarkDate, plural } from '../../lib/format';
import { Button } from '../primitives/Button';
import { Icon } from '../primitives/Icon';
import { SkeletonBar } from '../primitives/Feedback';
import { linkifyBody } from './linkify';
import styles from './HeldMessageSheet.module.css';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * §5.9 held message sheet. Route is `/screener/s/:senderId`, but per the
 * spec this reads as a sheet over the stack, not a route change — the
 * stack (CardStack/BulkReview) stays mounted behind it. `ScreenerRoute`
 * keeps the URL and `useUi().heldSheetSenderId` in sync; this component only
 * reads the store. Esc-to-close is already wired globally
 * (`useGlobalShortcuts`); this only needs the focus trap, scroll lock, and
 * the Screener-specific `a`/`d` decide-and-dismiss shortcuts.
 */
export function HeldMessageSheet() {
  const senderId = useUi((s) => s.heldSheetSenderId);
  const closeHeldSheet = useUi((s) => s.closeHeldSheet);
  const held = useMail((s) => s.held);
  const heldStatus = useMail((s) => s.status.held);
  const decide = useMail((s) => s.decide);
  const loadHeld = useMail((s) => s.loadHeld);
  const online = useOnline();

  const headerId = useId();
  const sheetRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  const entry = senderId ? held.find((h) => h.sender.id === senderId) : undefined;
  // The sheet knows which sender it is even when the message didn't load, and
  // §5.9 keeps the decision available in that state.
  const sheetSender = entry?.sender ?? (senderId ? { id: senderId } : null);
  const open = Boolean(senderId);

  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    function onTab(e: KeyboardEvent) {
      if (e.key !== 'Tab' || !sheetRef.current) return;
      const items = Array.from(sheetRef.current.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        last.focus();
        e.preventDefault();
      } else if (!e.shiftKey && document.activeElement === last) {
        first.focus();
        e.preventDefault();
      }
    }

    document.addEventListener('keydown', onTab);
    return () => {
      document.removeEventListener('keydown', onTab);
      document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus?.();
    };
  }, [open]);

  // §3.2 3b / §5.9 — `a`/`d` decide and dismiss while the sheet is open.
  useEffect(() => {
    if (!open || !entry) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== 'a' && e.key !== 'd') return;
      // The sheet is the top layer here, so it checks typing and modifiers
      // itself rather than going through shortcutsBlocked (which would see its
      // own open state and refuse).
      if (isTypingTarget(e.target)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (!online || !entry) return;
      e.preventDefault();
      void decide(entry.sender.id, e.key === 'a' ? 'approved' : 'declined').then((ok) => {
        if (ok) closeHeldSheet();
      });
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, entry, online, decide, closeHeldSheet]);

  if (!open) return null;

  function onScrimMouseDown(e: React.MouseEvent) {
    if (e.target === e.currentTarget) closeHeldSheet();
  }

  if (!entry && (heldStatus === 'loading' || heldStatus === 'idle')) {
    // §5.9's loading state. Deep-linking to /screener/s/:id on a cold start
    // used to fall straight through to "This message didn't load." while the
    // held list was still on its way — a false error, on the one path where
    // the sheet is the first thing a user sees.
    return (
      <div className={styles.scrim} onMouseDown={onScrimMouseDown}>
        <div ref={sheetRef} role="dialog" aria-modal="true" aria-label="Message" className={styles.sheet}>
          <header className={styles.header}>
            <div className={styles.headerRow}>
              <span className="t-lg" style={{ fontWeight: 600 }}>
                Message
              </span>
              <button ref={closeRef} type="button" aria-label="Close" className={styles.close} onClick={closeHeldSheet}>
                <Icon name="close" size={20} />
              </button>
            </div>
          </header>
          <div className={styles.body} aria-busy="true">
            <span className="visually-hidden">Loading message</span>
            {[0, 1, 2, 3, 4].map((i) => (
              <SkeletonBar key={i} width={['92%', '86%', '94%', '70%', '40%'][i]} height={12} />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (!entry) {
    // No local record of this sender — e.g. a stale link. §5.9's "message
    // didn't load" error state, best effort without card data to seed the
    // header from.
    return (
      <div className={styles.scrim} onMouseDown={onScrimMouseDown}>
        <div ref={sheetRef} role="dialog" aria-modal="true" aria-label="Message" className={styles.sheet}>
          <header className={styles.header}>
            <div className={styles.headerRow}>
              <span className="t-lg" style={{ fontWeight: 600 }}>
                Message
              </span>
              <button ref={closeRef} type="button" aria-label="Close" className={styles.close} onClick={closeHeldSheet}>
                <Icon name="close" size={20} />
              </button>
            </div>
          </header>
          <div className={cn(styles.body, styles.errorBody)}>
            <p className="t-md">This message didn&apos;t load.</p>
            <Button variant="tertiary" onClick={() => void loadHeld()}>
              Try again
            </Button>
          </div>
          {/*
            §5.9 — "the decision buttons stay enabled" in the error state. They
            were absent entirely, which is what makes this state a dead end: a
            sender whose message won't load is exactly one you still want to be
            able to decline.
          */}
          {sheetSender && (
            <footer className={styles.footer}>
              <Button
                variant="secondary-destructive"
                disabled={!online}
                onClick={() =>
                  void decide(sheetSender.id, 'declined').then((ok) => {
                    if (ok) closeHeldSheet();
                  })
                }
              >
                Decline sender
              </Button>
              <Button
                variant="primary"
                disabled={!online}
                onClick={() =>
                  void decide(sheetSender.id, 'approved').then((ok) => {
                    if (ok) closeHeldSheet();
                  })
                }
              >
                Approve sender
              </Button>
            </footer>
          )}
        </div>
      </div>
    );
  }

  const messages = [...entry.messages].sort((a, b) => b.date.localeCompare(a.date));
  const latest = messages[0];

  return (
    <div className={styles.scrim} onMouseDown={onScrimMouseDown}>
      <div ref={sheetRef} role="dialog" aria-modal="true" aria-labelledby={headerId} className={styles.sheet}>
        <header className={styles.header}>
          <div className={styles.headerRow}>
            <span className="t-base truncate">
              <span className={styles.from}>{entry.sender.name}</span>{' '}
              <span className="ink-tertiary">&lt;{entry.sender.email}&gt;</span>
            </span>
            <span className="t-mono-sm ink-tertiary">{formatPostmarkDate(latest.date)}</span>
          </div>
          <div className={styles.headerRow}>
            <span id={headerId} className={cn('t-lg', styles.subject, 'truncate')}>
              {latest.subject}
            </span>
            <button ref={closeRef} type="button" aria-label="Close" className={styles.close} onClick={closeHeldSheet}>
              <Icon name="close" size={20} />
            </button>
          </div>
        </header>

        <div className={styles.body}>
          {messages.map((m) => (
            <div key={m.id} className={styles.message}>
              <div className={styles.messageHeader}>
                <span className="t-sm">
                  {displayName(m.from)} <span className="ink-tertiary">&lt;{m.from.email}&gt;</span>
                </span>
                <span className="t-mono-sm ink-tertiary">{formatMessageTimestamp(m.date)}</span>
              </div>
              <p className={cn('t-md', styles.messageBody)}>{linkifyBody(m.body)}</p>
              <p className={cn('t-xs', 'ink-tertiary', styles.imagesNote)}>
                Images aren't loaded for senders you haven't approved.
              </p>
              {m.attachments.map((a) => (
                <div key={a.id} className={styles.attachment}>
                  <Icon name="attach" size={16} />
                  <span className="t-sm truncate">{a.filename}</span>
                  <span className="t-xs ink-tertiary">
                    · {formatBytes(a.size)} · (download disabled)
                  </span>
                </div>
              ))}
            </div>
          ))}
          {messages.length > 1 && (
            <p className="visually-hidden">{plural(messages.length, 'message')} held from this sender.</p>
          )}
        </div>

        <footer className={styles.footer}>
          <Button
            variant="secondary-destructive"
            disabled={!online}
            onClick={() =>
              void decide(entry.sender.id, 'declined').then((ok) => {
                if (ok) closeHeldSheet();
              })
            }
          >
            Decline sender
          </Button>
          <Button
            variant="primary"
            disabled={!online}
            onClick={() =>
              void decide(entry.sender.id, 'approved').then((ok) => {
                if (ok) closeHeldSheet();
              })
            }
          >
            Approve sender
          </Button>
        </footer>
      </div>
    </div>
  );
}
