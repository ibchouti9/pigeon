import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useBreakpoint } from '../../hooks/useBreakpoint';
import { useOnline } from '../../hooks/useOnline';
import { useCompose } from '../../store/compose';
import { useHeldCount, useMail, useUnreadCount } from '../../store/mail';
import { isTypingTarget, shortcutsBlocked } from '../../store/ui';
import type { Place } from '../../types';
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
  const openCompose = useCompose((s) => s.open);
  const heldCount = useHeldCount();
  const unreadCount = useUnreadCount();

  // D14 — the reply composer lives in the reading pane, not the dock.
  const [replyMode, setReplyMode] = useState<ReplyMode | null>(null);
  // Set when ⌘J opened the reply, so the composer starts drafting on mount.
  const [draftWithPigeon, setDraftWithPigeon] = useState(false);

  const { connected } = useAssistant();

  const listRef = useRef<MailListColumnHandle>(null);
  const cursorThreadIdRef = useRef<string | null>(null);

  const title = place === 'inbox' ? 'Inbox' : 'Archive';
  const otherPlace: Place = place === 'inbox' ? 'archive' : 'inbox';
  const selfEmail = account?.email ?? '';

  const openThread = threadId ? threads.find((t) => t.id === threadId) : undefined;

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
          : 'error';

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

  function goTo(id: string) {
    navigate(`/${place}/t/${id}`);
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
      navigate(next ? `/${place}/t/${next.id}` : `/${place}`, { replace: true });
    }
    void setPlace(id, otherPlace);
  }

  function archiveMany(ids: string[]) {
    const includesOpen = Boolean(threadId) && ids.includes(threadId as string);
    ids.forEach((id) => void setPlace(id, otherPlace));
    if (includesOpen) navigate(`/${place}`, { replace: true });
  }

  function closeThread(focusBack: boolean) {
    const prevId = threadId;
    navigate(`/${place}`);
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
          place={place}
          selfEmail={selfEmail}
          online={online}
          breakpoint={bp}
          backLabel={title}
          onBack={() => closeThread(true)}
          onRetryLoad={() => void loadThreads(place)}
          onArchive={() => threadId && archiveOne(threadId)}
          onReply={reply}
          summary={summary.hidden || summary.bullets.length === 0 ? undefined : summary.bullets}
          summaryState={summary.state === 'idle' ? undefined : summary.state}
          onRetrySummary={summary.summarize}
          onSummarize={summary.summarize}
          hasProvider={connected}
          replySlot={
            openThread && replyMode ? (
              <InlineReply
                key={`${openThread.id}-${replyMode}`}
                thread={openThread}
                mode={replyMode}
                draftOnOpen={draftWithPigeon}
                onClose={() => {
                  setReplyMode(null);
                  setDraftWithPigeon(false);
                }}
              />
            ) : undefined
          }
        />
      )}
    </div>
  );
}
