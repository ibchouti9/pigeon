import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useBreakpoint } from '../../hooks/useBreakpoint';
import { useOnline } from '../../hooks/useOnline';
import { useCompose } from '../../store/compose';
import { useHeldCount, useMail, useUnreadCount } from '../../store/mail';
import { isTypingTarget, shortcutsBlocked } from '../../store/ui';
import type { Place, Thread } from '../../types';
import { useAssistant } from '../../ai/useAssistant';
import { useThreadSummary } from '../../ai/useThreadSummary';
import { MailListColumn, type MailListColumnHandle } from './MailListColumn';
import { useThreadLanes } from '../../hooks/useThreadLanes';
import { useLanes } from '../../store/lanes';
import { LANES, LANE_KEYS, LANE_LABELS, threadSender } from '../../data/lanes';
import { toast } from '../../store/toast';
import { useLaneSort } from '../../ai/useLaneSort';
import { ThreadReader, type ThreadReaderStatus } from './ThreadReader';
import { useThreadReply } from './useThreadReply';
import styles from './MailPlaceScreen.module.css';

/**
 * §5.5 / §5.6 / §5.10 — the list column plus the reader for one place
 * (Inbox or Archive), wired to `useMail` with the URL selecting the open
 * thread. Archive differs from Inbox only in the four ways listed in §5.10.
 */
export function MailPlaceScreen({ place }: { place: Place }) {
  const { threadId } = useParams<{ threadId?: string }>();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const bp = useBreakpoint();
  const online = useOnline();

  const allThreads = useMail((s) => (place === 'inbox' ? s.inbox : s.archive));
  /*
   * Lanes are a read over the listing, not a filter the provider knows about.
   * `threads` below is the selected lane's slice and everything downstream —
   * the cursor, `j`/`k`, the archive-advances-to-next rule — operates on it, so
   * the keyboard stays inside the lane you are looking at rather than jumping
   * into mail the column isn't showing.
   */
  const lanes = useThreadLanes(allThreads, place);
  const selectLane = useLanes((s) => s.select);
  const correctLane = useLanes((s) => s.correct);
  const clearLaneCorrection = useLanes((s) => s.clearCorrection);
  const threads = lanes.threads;
  // Asks the model about the threads the rules were unsure of, in the
  // background, over the whole listing rather than the visible lane.
  useLaneSort(allThreads, place);
  const otherPlaceHasThreads = useMail((s) =>
    place === 'inbox' ? s.archive.length > 0 : false,
  );
  const status = useMail((s) => s.status[place]);
  const revoked = useMail((s) => s.revoked);
  const account = useMail((s) => s.account);
  const loadThreads = useMail((s) => s.loadThreads);
  const loadOlder = useMail((s) => s.loadOlder);
  const hasOlder = useMail((s) => s.hasOlder[place]);
  const loadingOlder = useMail((s) => s.loadingOlder[place]);
  const markRead = useMail((s) => s.markRead);
  const setPlace = useMail((s) => s.setPlace);
  const setPlaceMany = useMail((s) => s.setPlaceMany);
  const openCompose = useCompose((s) => s.open);
  const heldCount = useHeldCount();
  const unreadCount = useUnreadCount();


  const { connected } = useAssistant();

  const listRef = useRef<MailListColumnHandle>(null);
  const cursorThreadIdRef = useRef<string | null>(null);

  const title = place === 'inbox' ? 'Inbox' : 'Archive';
  const otherPlace: Place = place === 'inbox' ? 'archive' : 'inbox';
  const selfEmail = account?.email ?? '';

  const listed = threadId ? threads.find((t) => t.id === threadId) : undefined;

  /*
   * Two reasons the open thread has to come from the provider rather than the
   * list.
   *
   * A URL for a thread the loaded list doesn't hold — a bookmark, a link
   * someone was sent, or anything past the listing's window on a real account.
   * §5.6's error state offers "Try again", which reloads the same list and
   * still won't contain it: a dead end that looks like a failure.
   *
   * And a listed row that is only a *row*: the real provider lists
   * `Thread.preview` rows, which carry a sender, a subject and a preview line
   * and no bodies, because hydrating a whole mailbox to draw a list of names is
   * what made a 40,000-thread account unopenable. Reading needs the messages.
   *
   * `getThread` answers both, on both providers.
   */
  const [fetched, setFetched] = useState<Thread | null>(null);
  const [fetchFailed, setFetchFailed] = useState(false);
  const missing = Boolean(threadId) && !listed && status === 'ready';
  const unhydrated = Boolean(threadId) && Boolean(listed?.preview);

  useEffect(() => {
    setFetched(null);
    setFetchFailed(false);
  }, [threadId]);

  useEffect(() => {
    if ((!missing && !unhydrated) || !threadId) return;
    const { provider } = useMail.getState();

    /*
     * The cleanup is the guard, and it covers both ways this can land on the
     * wrong screen: navigating to another thread mid-fetch, and disconnecting
     * — `setProvider` resets the place's status, so `missing` goes false and
     * this tears down. A providerEpoch check on top of it never fires.
     */
    let live = true;

    provider
      .getThread(threadId)
      .then((thread) => {
        if (live) setFetched(thread);
      })
      .catch(() => {
        if (live) setFetchFailed(true);
      });

    return () => {
      live = false;
    };
  }, [missing, unhydrated, threadId]);

  /*
   * The fetched conversation wins. A listed row for the same thread may be a
   * preview, and showing that in the reader is showing one synthetic message
   * where a conversation belongs — the row's own preview line dressed up as the
   * whole of what someone wrote.
   */
  const openThread = fetched ?? (unhydrated ? undefined : listed) ?? undefined;

  // D14 — the reply composer lives in the reading pane, not the dock.
  const reply = useThreadReply(openThread, online);

  // D5 — automatic above the threshold, a button below it.
  const summary = useThreadSummary(openThread ?? null);

  const readerStatus: ThreadReaderStatus = !threadId
    ? 'none'
    : openThread
      ? 'ready'
      : status === 'loading' || status === 'idle'
        ? 'loading'
        : status === 'error'
          ? 'none'
          : // Still asking the provider for it: the reader keeps §5.6's skeleton
            // rather than claiming a failure that hasn't happened yet.
            fetchFailed
            ? 'error'
            : 'loading';

  // §3.4 step 1 — mark read after 1,200ms of continuous display.
  // The shell loads the inbox at mount because the rail's unread count needs
  // it everywhere. Every other place fetches when its screen opens.
  useEffect(() => {
    if (place === 'inbox') return;
    void loadThreads(place);
  }, [place, loadThreads]);

  useEffect(() => {
    if (place !== 'inbox' || !openThread || !openThread.unread) return;
    const timer = setTimeout(() => void markRead(openThread.id), 1200);
    return () => clearTimeout(timer);
  }, [place, openThread, markRead]);

  /**
   * Every navigation inside a place carries the query string. Nothing
   * user-facing lives there today, but `?scenario=` does — and dropping it on
   * the first thread you open made the dev harness lie about which state it
   * was showing (§8.5 item 1 rests on that harness).
   */
  function pathIn(suffix = ''): string {
    const search = params.toString();
    return `/${place}${suffix}${search ? `?${search}` : ''}`;
  }

  function goTo(id: string) {
    navigate(pathIn(`/t/${id}`));
  }

  /**
   * Archives (or restores) one thread. If it's the open thread, advances the
   * reader to the next row first — this single function is what both the
   * per-row hover button and the keyboard `e` shortcut call, in the list and
   * in the reader alike (§8.1's two `e` entries collapse to one behaviour).
   */
  function archiveOne(id: string) {
    if (id === threadId) {
      const idx = threads.findIndex((t) => t.id === id);
      const next = threads[idx + 1] ?? threads[idx - 1];
      navigate(next ? pathIn(`/t/${next.id}`) : pathIn(), { replace: true });
    }
    void setPlace(id, otherPlace);
  }

  function archiveMany(ids: string[]) {
    const includesOpen = Boolean(threadId) && ids.includes(threadId as string);
    // One call, so the selection gets one toast with one undo. Calling
    // setPlace per thread pushed a toast each, and past the third the earlier
    // ones left the screen with their undo still unused.
    void setPlaceMany(ids, otherPlace);
    if (includesOpen) navigate(pathIn(), { replace: true });
  }

  function closeThread(focusBack: boolean) {
    const prevId = threadId;
    navigate(pathIn());
    if (focusBack && prevId) {
      requestAnimationFrame(() => listRef.current?.focusThread(prevId));
    }
  }


  // §8.1 "In a thread list" / "In a thread" — e/r/a/f/u need to know whether
  // a thread is currently open, so they live here rather than in the list.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (isTypingTarget(e.target)) return;

      // §5.6 — ⌘J drafts with Pigeon and "opens the composer if closed". The
      // composer handles it once focus is inside; this is the path from
      // reading a thread with no reply open, which is the case the wording is
      // actually about.
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'j') {
        if (openThread && online && !reply.mode) {
          reply.openDrafting('reply');
          e.preventDefault();
        }
        return;
      }

      if (shortcutsBlocked(e)) return;

      /*
       * Shift+U — leave it unread, the way Gmail spells it.
       *
       * It returns to the list on purpose rather than as a convenience: the
       * reader marks whatever it is showing read after 1,200ms, so marking an
       * open thread unread and staying put would simply be undone a second
       * later. Closing is also what the action means — this thread is for
       * later — and it matches what the same key does in Gmail.
       */
      if (e.shiftKey && e.key === 'U' && place === 'inbox') {
        const id = threadId ?? cursorThreadIdRef.current;
        if (id) {
          void markRead(id, false);
          if (threadId) closeThread(true);
          e.preventDefault();
        }
        return;
      }

      /*
       * Lanes on the number row. Bound to the canonical lane order rather than
       * to the chips on screen, so `3` is Offers on every account and on every
       * day — a digit that changes meaning because a campaign arrived
       * overnight is worse than one that occasionally does nothing.
       */
      if (lanes.enabled && /^[0-5]$/.test(e.key) && !e.metaKey && !e.ctrlKey && !e.altKey) {
        if (e.key === '0') {
          selectLane('all');
          e.preventDefault();
          return;
        }
        const lane = LANES.find((l) => LANE_KEYS[l] === e.key);
        // An empty lane has no chip, so selecting it would leave the user in a
        // column with nothing in it and nothing visible to click back out of.
        if (lane && lanes.counts[lane] > 0) {
          selectLane(lane);
          e.preventDefault();
        }
        return;
      }

      switch (e.key) {
        case 'e': {
          const id = threadId ?? cursorThreadIdRef.current;
          if (id) archiveOne(id);
          e.preventDefault();
          break;
        }
        case 'r':
          if (openThread) {
            reply.open('reply');
            e.preventDefault();
          }
          break;
        case 'a':
          if (openThread) {
            reply.open('reply-all');
            e.preventDefault();
          }
          break;
        case 'f':
          if (openThread) {
            reply.open('forward');
            e.preventDefault();
          }
          break;
        case 'u':
          if (threadId) {
            closeThread(true);
            e.preventDefault();
          }
          break;
        case 'Escape':
          // §5.0 narrow tablet — Esc also returns to the list at this width.
          if (threadId && bp === 'narrow') {
            closeThread(true);
            e.preventDefault();
          }
          break;
        default:
          break;
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadId, threads, openThread, bp, online, reply.mode, lanes.enabled, lanes.counts]);

  // §5.0 narrow tablet (720–879px) — list and reader are a single column.
  const showList = bp !== 'narrow' || !threadId;
  const showReader = bp !== 'narrow' || Boolean(threadId);

  return (
    <div className={styles.screen}>
      {showList && (
        <MailListColumn
          ref={listRef}
          place={place}
          title={title}
          threads={threads}
          status={status}
          online={online}
          revoked={revoked}
          openThreadId={threadId}
          heldCount={heldCount}
          unreadCount={place === 'inbox' ? unreadCount : undefined}
          hasArchivedAny={place === 'inbox' ? otherPlaceHasThreads : undefined}
          fullWidth={bp === 'narrow'}
          onOpenThread={goTo}
          onArchiveThread={archiveOne}
          onArchiveMany={archiveMany}
          onCursorChange={(id) => {
            cursorThreadIdRef.current = id;
          }}
          onOpenScreener={() => navigate('/screener')}
          onSendTest={() =>
            openCompose({
              to: account ? [{ name: account.name, email: account.email }] : [],
            })
          }
          onRetry={() => void loadThreads(place)}
          onConnectGmail={() => navigate('/settings/account')}
          hasOlder={hasOlder}
          loadingOlder={loadingOlder}
          onLoadOlder={() => void loadOlder(place)}
          lanes={lanes}
          onSelectLane={selectLane}
        />
      )}
      {showReader && (
        <ThreadReader
          status={readerStatus}
          thread={openThread}
          pendingSubject={threads.find((t) => t.id === threadId)?.subject}
          place={place}
          selfEmail={selfEmail}
          online={online}
          breakpoint={bp}
          backLabel={title}
          onBack={() => closeThread(true)}
          onRetryLoad={() => {
            // Clearing this re-runs the single-thread fetch. Reloading only the
            // list would retry the thing that already succeeded.
            setFetchFailed(false);
            void loadThreads(place);
          }}
          onArchive={() => threadId && archiveOne(threadId)}
          onReply={reply.open}
          summary={summary.hidden || summary.bullets.length === 0 ? undefined : summary.bullets}
          summaryState={summary.state === 'idle' ? undefined : summary.state}
          summaryFailedText={summary.failedText ?? undefined}
          onRetrySummary={summary.summarize}
          onSummarize={summary.summarize}
          hasProvider={connected}
          replySlot={reply.slot}
          lane={threadId ? lanes.laneOf(threadId) : undefined}
          onCorrectLane={(lane) => {
            if (!openThread) return;
            const sender = threadSender(openThread);
            correctLane(sender.email, lane);
            toast.confirm(`Mail from ${sender.email} goes to ${LANE_LABELS[lane]}.`);
          }}
          onClearLaneCorrection={() => {
            if (!openThread) return;
            clearLaneCorrection(threadSender(openThread).email);
          }}
        />
      )}
    </div>
  );
}
