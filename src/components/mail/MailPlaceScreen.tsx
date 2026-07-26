import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useBreakpoint } from '../../hooks/useBreakpoint';
import { useOnline } from '../../hooks/useOnline';
import { useCompose } from '../../store/compose';
import { useHeldCount, useMail, useUnreadCount } from '../../store/mail';
import { isTypingTarget, shortcutsBlocked } from '../../store/ui';
import type { Draft, Place, Thread } from '../../types';
import { useAssistant } from '../../ai/useAssistant';
import { useThreadSummary } from '../../ai/useThreadSummary';
import { InlineReply } from './InlineReply';
import { MailListColumn, type MailListColumnHandle } from './MailListColumn';
import { ThreadReader, type ReplyMode, type ThreadReaderStatus } from './ThreadReader';
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

  const threads = useMail((s) => (place === 'inbox' ? s.inbox : s.archive));
  const otherPlaceHasThreads = useMail((s) =>
    place === 'inbox' ? s.archive.length > 0 : false,
  );
  const status = useMail((s) => s.status[place]);
  const revoked = useMail((s) => s.revoked);
  const account = useMail((s) => s.account);
  const loadThreads = useMail((s) => s.loadThreads);
  const markRead = useMail((s) => s.markRead);
  const setPlace = useMail((s) => s.setPlace);
  const setPlaceMany = useMail((s) => s.setPlaceMany);
  const openCompose = useCompose((s) => s.open);
  const heldCount = useHeldCount();
  const unreadCount = useUnreadCount();

  // D14 — the reply composer lives in the reading pane, not the dock.
  const [replyMode, setReplyMode] = useState<ReplyMode | null>(null);
  /** Set by an undo, so the reopened composer holds what the user wrote. */
  const [restoredDraft, setRestoredDraft] = useState<Draft | null>(null);
  // Set when ⌘J opened the reply, so the composer starts drafting on mount.
  const [draftWithPigeon, setDraftWithPigeon] = useState(false);

  const { connected } = useAssistant();

  const listRef = useRef<MailListColumnHandle>(null);
  const cursorThreadIdRef = useRef<string | null>(null);

  const title = place === 'inbox' ? 'Inbox' : 'Archive';
  const otherPlace: Place = place === 'inbox' ? 'archive' : 'inbox';
  const selfEmail = account?.email ?? '';

  const listed = threadId ? threads.find((t) => t.id === threadId) : undefined;

  /*
   * A reader URL for a thread the loaded list doesn't hold — a bookmark, a
   * link someone was sent, or on a real Gmail account anything past the walk's
   * 2,000-thread ceiling. §5.6's error state offers "Try again", which reloads
   * the same list and still won't contain it: a dead end that looks like a
   * failure. `getThread` exists on both providers for exactly this.
   */
  const [fetched, setFetched] = useState<Thread | null>(null);
  const [fetchFailed, setFetchFailed] = useState(false);
  const missing = Boolean(threadId) && !listed && status === 'ready';

  useEffect(() => {
    setFetched(null);
    setFetchFailed(false);
  }, [threadId]);

  useEffect(() => {
    if (!missing || !threadId) return;
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
  }, [missing, threadId]);

  const openThread = listed ?? fetched ?? undefined;

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

  function reply(mode: ReplyMode) {
    if (!openThread || !online) return;
    setDraftWithPigeon(false);
    setReplyMode(mode);
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
        if (openThread && online && !replyMode) {
          setReplyMode('reply');
          setDraftWithPigeon(true);
          e.preventDefault();
        }
        return;
      }

      if (shortcutsBlocked(e)) return;

      switch (e.key) {
        case 'e': {
          const id = threadId ?? cursorThreadIdRef.current;
          if (id) archiveOne(id);
          e.preventDefault();
          break;
        }
        case 'r':
          if (openThread) {
            reply('reply');
            e.preventDefault();
          }
          break;
        case 'a':
          if (openThread) {
            reply('reply-all');
            e.preventDefault();
          }
          break;
        case 'f':
          if (openThread) {
            reply('forward');
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
  }, [threadId, threads, openThread, bp, online, replyMode]);

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
          onReply={reply}
          summary={summary.hidden || summary.bullets.length === 0 ? undefined : summary.bullets}
          summaryState={summary.state === 'idle' ? undefined : summary.state}
          summaryFailedText={summary.failedText ?? undefined}
          onRetrySummary={summary.summarize}
          onSummarize={summary.summarize}
          hasProvider={connected}
          replySlot={
            openThread && replyMode ? (
              <InlineReply
                key={`${openThread.id}-${replyMode}-${restoredDraft?.id ?? ''}`}
                thread={openThread}
                mode={replyMode}
                draftOnOpen={draftWithPigeon}
                initialDraft={restoredDraft ?? undefined}
                onRestore={(draft) => {
                  setRestoredDraft(draft);
                  setReplyMode(draft.mode === 'forward' ? 'forward' : 'reply');
                }}
                onClose={() => {
                  setReplyMode(null);
                  setDraftWithPigeon(false);
                  setRestoredDraft(null);
                }}
              />
            ) : undefined
          }
        />
      )}
    </div>
  );
}
