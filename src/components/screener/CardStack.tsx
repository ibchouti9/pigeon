import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useMail, type LoadStatus } from '../../store/mail';
import { useUi, isTypingTarget } from '../../store/ui';
import { displayName, plural } from '../../lib/format';
import { cn } from '../../lib/cn';
import type { HeldSender } from '../../types';
import { SenderCard } from './SenderCard';
import cardStyles from './SenderCard.module.css';
import { SkeletonBar, SkeletonCircle } from '../primitives/Feedback';
import { rotateFrom, BEHIND_INSETS } from './stack';
import { MOTION } from './motion';
import styles from './CardStack.module.css';

export interface CardStackProps {
  held: HeldSender[];
  status: LoadStatus;
  /** Sender id → live AI read, from `useScreenerAi().reads`. */
  reads: Record<string, string>;
  online: boolean;
  onRead: (senderId: string) => void;
  onToggleView: () => void;
}

type Overlay =
  | { kind: 'approved' | 'declined'; entry: HeldSender }
  | { kind: 'cycleNext' | 'cyclePrev'; entry: HeldSender };

/**
 * §5.7 card stack. Only the top card exists for assistive technology (§8.4);
 * behind cards are decorative fills positioned with opposing insets against
 * a 560px wrapper that takes its height from the live card.
 */
export function CardStack({ held, status, reads, online, onRead, onToggleView }: CardStackProps) {
  const decide = useMail((s) => s.decide);
  const heldSheetSenderId = useUi((s) => s.heldSheetSenderId);
  const countId = useId();

  const [topId, setTopId] = useState<string | null>(null);
  const [overlay, setOverlay] = useState<Overlay | null>(null);
  const [enter, setEnter] = useState<'rise' | 'fromRight' | 'fromLeft' | null>(null);
  const [announce, setAnnounce] = useState('');
  const [errorId, setErrorId] = useState<string | null>(null);

  const cardRef = useRef<HTMLElement | null>(null);
  const hasFocused = useRef(false);
  const wasSheetOpen = useRef(false);
  const errorTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const ordered = rotateFrom(held, topId);
  const top = ordered[0] as HeldSender | undefined;
  const behind1 = ordered[1] as HeldSender | undefined;
  const behind2 = ordered[2] as HeldSender | undefined;
  const position = top ? held.findIndex((h) => h.sender.id === top.sender.id) + 1 : 0;

  // Route entry: the card region takes focus so single-key shortcuts work
  // without a click (§8.4). This has to wait for the first real card — on
  // mount the stack is still a skeleton and there is nothing to focus, and an
  // empty-dependency effect would never run again once there was.
  useEffect(() => {
    if (hasFocused.current || status !== 'ready' || !cardRef.current) return;
    hasFocused.current = true;
    cardRef.current.focus();
  }, [status, top?.sender.id]);

  // §5.9 — closing the held-message sheet returns focus to the card.
  useEffect(() => {
    if (heldSheetSenderId) {
      wasSheetOpen.current = true;
    } else if (wasSheetOpen.current) {
      wasSheetOpen.current = false;
      cardRef.current?.focus();
    }
  }, [heldSheetSenderId]);

  useEffect(
    () => () => {
      if (errorTimer.current) clearTimeout(errorTimer.current);
    },
    [],
  );

  const cycle = useCallback(
    (dir: 1 | -1) => {
      if (overlay || ordered.length < 2) return;
      const current = ordered[0];
      const next = dir === 1 ? ordered[1] : ordered[ordered.length - 1];
      setOverlay({ kind: dir === 1 ? 'cycleNext' : 'cyclePrev', entry: current });
      setTopId(next.sender.id);
      setEnter(dir === 1 ? 'fromRight' : 'fromLeft');
      const ms = MOTION.base();
      setTimeout(() => setOverlay(null), ms);
      setTimeout(() => setEnter(null), ms);
    },
    [overlay, ordered],
  );

  const handleDecide = useCallback(
    async (decision: 'approved' | 'declined') => {
      if (!online || !top || overlay) return;
      const current = top;
      const nextEntry = ordered[1] as HeldSender | undefined;
      const nextId = nextEntry?.sender.id ?? null;
      const senderId = current.sender.id;
      const who = decision === 'approved' ? displayName(current.sender) : current.sender.email;
      const remaining = held.length - 1;
      const nextName = nextEntry ? displayName(nextEntry.sender) : null;

      setOverlay({ kind: decision, entry: current });
      setTopId(nextId);
      setEnter('rise');

      const totalMs = Math.max(MOTION.departDelay() + MOTION.base(), MOTION.stamp());
      const clearTimer = setTimeout(() => {
        setOverlay(null);
        setEnter(null);
      }, totalMs);

      const ok = await decide(senderId, decision);
      if (!ok) {
        // §3.2 3d — roll the local animation back too; never leave the card gone.
        clearTimeout(clearTimer);
        setOverlay(null);
        setEnter(null);
        setTopId(senderId);
        setErrorId(senderId);
        if (errorTimer.current) clearTimeout(errorTimer.current);
        errorTimer.current = setTimeout(() => setErrorId(null), 3000);
        return;
      }

      const verb = decision === 'approved' ? 'Approved' : 'Declined';
      setAnnounce(
        nextName
          ? `${verb} ${who}. ${plural(remaining, 'sender')} waiting. Now showing ${nextName}.`
          : `${verb} ${who}. ${plural(remaining, 'sender')} waiting.`,
      );
    },
    [online, top, overlay, ordered, held, decide],
  );

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (isTypingTarget(e.target)) return;
      const ui = useUi.getState();
      if (ui.heldSheetSenderId || ui.dialog || ui.shortcutsOpen) return;
      switch (e.key) {
        case 'a':
          void handleDecide('approved');
          e.preventDefault();
          break;
        case 'd':
          void handleDecide('declined');
          e.preventDefault();
          break;
        case 'o':
          if (top) onRead(top.sender.id);
          e.preventDefault();
          break;
        case 'j':
          cycle(1);
          e.preventDefault();
          break;
        case 'k':
          cycle(-1);
          e.preventDefault();
          break;
        case 'b':
          onToggleView();
          e.preventDefault();
          break;
        default:
          break;
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
    // Deps re-subscribe on every relevant state change so the closures above
    // never go stale — the listener itself is cheap to recreate.
  }, [held, topId, online, overlay, top, onRead, onToggleView, handleDecide, cycle]);

  if (status !== 'ready') {
    return (
      <div className={styles.stack}>
        <div className={styles.wrapper}>
          <div className={cn(cardStyles.card, styles.skeleton)} aria-busy="true">
            <span className="visually-hidden">Loading</span>
            <SkeletonCircle size={40} />
            <SkeletonBar width="55%" height={16} />
            <SkeletonBar width="35%" height={12} />
            <SkeletonBar width="90%" height={12} />
            <SkeletonBar width="70%" height={12} />
            <SkeletonBar width="50%" height={12} />
          </div>
        </div>
      </div>
    );
  }

  if (!top) return null;

  return (
    <section aria-label="Screener" aria-describedby={countId} className={styles.stack}>
      <p id={countId} className="visually-hidden">
        {position} of {plural(held.length, 'sender')} waiting.
      </p>

      <div className={styles.wrapper} data-testid="card-stack-wrapper">
        {behind2 && (
          <div
            aria-hidden="true"
            data-testid="card-behind-2"
            className={cn(styles.behind, styles.behind2)}
            style={{
              left: BEHIND_INSETS[1].left,
              right: BEHIND_INSETS[1].right,
              top: BEHIND_INSETS[1].top,
              bottom: BEHIND_INSETS[1].bottom,
            }}
          />
        )}
        {behind1 && (
          <div
            aria-hidden="true"
            data-testid="card-behind-1"
            className={styles.behind}
            style={{
              left: BEHIND_INSETS[0].left,
              right: BEHIND_INSETS[0].right,
              top: BEHIND_INSETS[0].top,
              bottom: BEHIND_INSETS[0].bottom,
            }}
          />
        )}

        <SenderCard
          ref={cardRef}
          entry={top}
          aiRead={reads[top.sender.id]}
          disabled={!online}
          enter={enter}
          error={errorId === top.sender.id}
          onApprove={() => void handleDecide('approved')}
          onDecline={() => void handleDecide('declined')}
          onRead={() => onRead(top.sender.id)}
        />

        {overlay && (
          <div
            className={cn(
              styles.overlaySlot,
              overlay.kind === 'cycleNext' && styles.cycleExitNext,
              overlay.kind === 'cyclePrev' && styles.cycleExitPrev,
            )}
          >
            <SenderCard
              entry={overlay.entry}
              aiRead={reads[overlay.entry.sender.id]}
              interactive={false}
              deciding={overlay.kind === 'approved' || overlay.kind === 'declined' ? overlay.kind : null}
            />
          </div>
        )}
      </div>

      <p className={cn('t-mono-sm', 'ink-tertiary', styles.counter)}>
        {position} of {held.length}
      </p>

      <div role="status" aria-live="polite" className="visually-hidden">
        {announce}
      </div>
    </section>
  );
}
