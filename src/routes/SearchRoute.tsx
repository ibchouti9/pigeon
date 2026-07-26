import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import type { HeldSender, Thread } from '../types';
import type { SearchResults } from '../data/provider';
import { useMail } from '../store/mail';
import { shortcutsBlocked, useUi } from '../store/ui';
import { useOnline } from '../hooks/useOnline';
import { useMinimumVisible } from '../hooks/useMinimumVisible';
import { useBreakpoint } from '../hooks/useBreakpoint';
import { useThreadSummary } from '../ai/useThreadSummary';
import { useAssistant } from '../ai/useAssistant';
import { Button } from '../components/primitives/Button';
import { Checkbox } from '../components/primitives/Field';
import { Icon } from '../components/primitives/Icon';
import { Monogram } from '../components/primitives/Monogram';
import { EmptyState, SkeletonRows } from '../components/primitives/Feedback';
import { ThreadRow } from '../components/mail/ThreadRow';
import { ThreadReader } from '../components/mail/ThreadReader';
import { cn } from '../lib/cn';
import {
  displayName,
  formatCount,
  formatListTimestamp,
  relativeTime,
} from '../lib/format';
import { highlightTerms } from '../lib/highlight';
import styles from './SearchRoute.module.css';

const DEBOUNCE_MS = 250;
const MIN_QUERY = 2;
const MAX_RECENT = 5;
const RECENT_KEY = 'pigeon.recentSearches';

type Status = 'empty' | 'loading' | 'ready' | 'error';

function readRecent(): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]') as unknown;
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

function rememberRecent(query: string): string[] {
  const next = [query, ...readRecent().filter((q) => q !== query)].slice(0, MAX_RECENT);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // Recent searches are a convenience, not state worth failing over.
  }
  return next;
}

const EMPTY_RESULTS: SearchResults = { inbox: [], archive: [], held: [] };

/** §5.11 — search covers Inbox and Archive; held mail is opt-in (D12). */
export function SearchRoute() {
  const { threadId } = useParams<{ threadId?: string }>();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const online = useOnline();
  const bp = useBreakpoint();

  const search = useMail((s) => s.search);
  const account = useMail((s) => s.account);
  const setPlace = useMail((s) => s.setPlace);
  const openHeldSheet = useUi((s) => s.openHeldSheet);
  const { connected } = useAssistant();

  const query = params.get('q') ?? '';
  // D12 — the toggle persists for the session.
  const includeHeld = params.get('held') === '1';

  const [draftQuery, setDraftQuery] = useState(query);
  const [results, setResults] = useState<SearchResults>(EMPTY_RESULTS);
  const [status, setStatus] = useState<Status>('empty');
  const [recent, setRecent] = useState<string[]>(readRecent);
  const [cursor, setCursor] = useState(0);
  /**
   * §7.6's "Search didn't run. Try again." needs something for the search
   * effect to react to. It used to re-set `draftQuery` to a trimmed copy of
   * itself — but the debounce trims before it searches, so the value was
   * always already identical, React bailed out, and the button was a permanent
   * no-op: the only way out of a failed search was editing the query.
   */
  const [retry, setRetry] = useState(0);
  // C-21 — no sub-200ms flash of skeleton rows on a fast search.
  const showSkeleton = useMinimumVisible(status === 'loading');
  const inputRef = useRef<HTMLInputElement>(null);
  const latestRequest = useRef(0);

  useEffect(() => {
    setDraftQuery(query);
  }, [query]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // The functional updater keeps this stable. Closing over `params` instead
  // would give it a new identity every render, and since the debounce effect
  // below depends on it and calls it, the two would drive each other in a loop.
  const setQuery = useCallback(
    (next: string) => {
      setParams(
        (prev) => {
          const updated = new URLSearchParams(prev);
          if (next) updated.set('q', next);
          else updated.delete('q');
          return updated;
        },
        { replace: true },
      );
    },
    [setParams],
  );

  // Runs 250ms after the last keystroke, minimum 2 characters (§5.11).
  useEffect(() => {
    const trimmed = draftQuery.trim();
    if (trimmed.length < MIN_QUERY) {
      setResults(EMPTY_RESULTS);
      setStatus('empty');
      return;
    }

    const timer = setTimeout(() => {
      const request = ++latestRequest.current;
      setStatus('loading');
      setQuery(trimmed);
      search(trimmed, includeHeld)
        .then((found) => {
          if (request !== latestRequest.current) return;
          setResults(found);
          setStatus('ready');
          setRecent(rememberRecent(trimmed));
        })
        .catch(() => {
          if (request !== latestRequest.current) return;
          setStatus('error');
        });
    }, DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [draftQuery, includeHeld, search, setQuery, retry]);

  const groups = useMemo(
    () =>
      [
        { label: 'Inbox', threads: results.inbox },
        { label: 'Archive', threads: results.archive },
      ].filter((g) => g.threads.length > 0),
    [results],
  );

  const flatThreads = useMemo(() => groups.flatMap((g) => g.threads), [groups]);
  const total = flatThreads.length + (includeHeld ? results.held.length : 0);

  const storedThread = useMail((s) =>
    [...s.inbox, ...s.archive].find((t) => t.id === threadId),
  );
  const thread: Thread | undefined =
    storedThread ?? flatThreads.find((t) => t.id === threadId);
  const summary = useThreadSummary(thread ?? null);

  function toggleHeld() {
    setParams(
      (prev) => {
        const updated = new URLSearchParams(prev);
        if (includeHeld) updated.delete('held');
        else updated.set('held', '1');
        return updated;
      },
      { replace: true },
    );
  }

  /**
   * §5.11 renders the reader beside the results, so opening one has to keep the
   * search alive. The query and the held toggle live in the query string and
   * `/search/t/:id` drops it, which cleared the query, threw away the results,
   * and left the screen showing recent searches next to an open thread.
   */
  function openResult(threadId: string) {
    const search = params.toString();
    navigate(`/search/t/${threadId}${search ? `?${search}` : ''}`);
  }

  function closeResult() {
    const search = params.toString();
    navigate(`/search${search ? `?${search}` : ''}`);
  }

  function focusRow(index: number) {
    document.querySelector<HTMLElement>(`[data-search-row="${index}"]`)?.focus();
  }

  function moveCursor(to: number) {
    if (!flatThreads.length) return;
    const next = Math.min(flatThreads.length - 1, Math.max(0, to));
    setCursor(next);
    focusRow(next);
  }

  // §8.1 puts Search in the thread-list scope. Nothing here was bound, and the
  // rows carry a roving tabindex keyed to `cursor` — which was a frozen 0 — so
  // only the first result was reachable by Tab and nothing could move off it.
  // Bulk keys (x, Shift+J/K) are deliberately absent: §5.11 gives this screen
  // no selection model, and the rows pass a no-op toggle.
  useEffect(() => {
    function onListKeyDown(e: KeyboardEvent) {
      if (shortcutsBlocked(e)) return;
      if (!flatThreads.length) return;

      switch (e.key) {
        case 'j':
        case 'ArrowDown':
          moveCursor(cursor + 1);
          e.preventDefault();
          break;
        case 'k':
        case 'ArrowUp':
          moveCursor(cursor - 1);
          e.preventDefault();
          break;
        case 'Home':
          moveCursor(0);
          e.preventDefault();
          break;
        case 'End':
          moveCursor(flatThreads.length - 1);
          e.preventDefault();
          break;
        case 'Enter':
        case 'o': {
          const thread = flatThreads[cursor];
          if (thread) openResult(thread.id);
          e.preventDefault();
          break;
        }
        case 'e': {
          const thread = flatThreads[cursor];
          // §8.1 — "archive the cursor row (Inbox) / move to inbox (Archive)".
          // Results carry their real place and the list is grouped by it, so an
          // ARCHIVE row was being re-archived where it should come back.
          if (thread && online) {
            void setPlace(thread.id, thread.place === 'inbox' ? 'archive' : 'inbox');
          }
          e.preventDefault();
          break;
        }
        default:
          break;
      }
    }

    window.addEventListener('keydown', onListKeyDown);
    return () => window.removeEventListener('keydown', onListKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flatThreads, cursor, online, navigate]);

  // A new result set invalidates wherever the cursor was pointing.
  useEffect(() => {
    setCursor(0);
  }, [results]);

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape') {
      if (draftQuery) {
        setDraftQuery('');
        setQuery('');
      } else {
        navigate(-1);
      }
      e.stopPropagation();
    } else if (e.key === 'ArrowDown' && flatThreads.length) {
      // §5.11 — "↓ from the field moves the cursor into results".
      moveCursor(0);
      e.preventDefault();
    }
  }

  const metaPlaces = includeHeld ? 'Inbox, Archive and held mail' : 'Inbox and Archive';

  const listColumn = (
    <div className={cn(styles.column, bp === 'narrow' && !threadId && styles.fullWidth)}>
      <div className={styles.queryBar}>
        <Icon name="search" size={16} className={styles.queryIcon} />
        <input
          ref={inputRef}
          type="search"
          className={cn('t-base', styles.queryInput)}
          value={draftQuery}
          placeholder="Search mail"
          aria-label="Search mail"
          data-search-field="results"
          onChange={(e) => setDraftQuery(e.currentTarget.value)}
          onKeyDown={onKeyDown}
        />
        {draftQuery && (
          <Button
            variant="icon"
            size="sm"
            aria-label="Clear search"
            onClick={() => {
              setDraftQuery('');
              setQuery('');
              inputRef.current?.focus();
            }}
          >
            <Icon name="close" size={16} />
          </Button>
        )}
      </div>

      {status !== 'empty' && (
        <div className={styles.meta}>
          <span className={cn('t-sm', styles.metaCount)}>
            {/*
              §5.11 gives the meta line a count and the places searched, and
              gives the error its own block below. Putting "Search didn't run."
              in both said the same sentence to the user twice, and a count
              nobody has is not a count.
            */}
            {status === 'loading'
              ? 'Searching…'
              : status === 'error'
                ? metaPlaces
                : `${formatCount(total)} ${total === 1 ? 'result' : 'results'} · ${metaPlaces}`}
          </span>
          <label className={cn('t-sm', styles.heldToggle)}>
            <Checkbox checked={includeHeld} onChange={toggleHeld} />
            Also search held mail
          </label>
        </div>
      )}

      <div className={styles.results}>
        {status === 'empty' && recent.length > 0 && (
          <>
            <h2 className={cn('t-mono-sm', styles.groupHeader)}>RECENT</h2>
            {recent.map((entry) => (
              <button
                key={entry}
                type="button"
                className={cn('t-sm', styles.recent)}
                onClick={() => setDraftQuery(entry)}
              >
                <Icon name="clock" size={16} className={styles.recentIcon} />
                {entry}
              </button>
            ))}
          </>
        )}

        {status === 'empty' && recent.length === 0 && (
          <EmptyState
            level="component"
            body="Search your mail by sender, subject, or words in the message."
          />
        )}

        {showSkeleton && <SkeletonRows count={5} label="Searching" />}

        {status === 'error' && (
          <EmptyState
            level="component"
            body="Search didn't run. Try again."
            action={
              <Button variant="secondary" onClick={() => setRetry((n) => n + 1)}>
                Try again
              </Button>
            }
          />
        )}

        {status === 'ready' && total === 0 && (
          <EmptyState
            level="component"
            headline={`No results for "${query}".`}
            body="Try fewer words, or search a sender's address."
            action={
              includeHeld ? undefined : (
                <Button variant="tertiary" onClick={toggleHeld}>
                  Also search held mail
                </Button>
              )
            }
          />
        )}

        {status === 'ready' && total > 0 && (
          <div role="list" aria-label={`${formatCount(total)} results`}>
            {groups.map((group) => (
              <div key={group.label}>
                <h2 className={cn('t-mono-sm', styles.groupHeader)}>
                  {group.label.toUpperCase()}
                </h2>
                {group.threads.map((t) => {
                  const index = flatThreads.indexOf(t);
                  const sender =
                    t.messages.find((m) => !m.isFromUser)?.from ?? t.messages[0].from;
                  const snippet = t.messages[t.messages.length - 1].body.slice(0, 140);
                  return (
                    <ThreadRow
                      key={t.id}
                      sender={displayName(sender)}
                      senderEmail={sender.email}
                      subject={t.subject}
                      snippet={snippet}
                      // §5.11 — "matched terms in the subject and snippet are
                      // wrapped in a mark". Only the held rows had it; the
                      // thread rows, which are most of every result set, showed
                      // nothing marked at all.
                      subjectNode={highlightTerms(t.subject, query, styles.mark)}
                      snippetNode={highlightTerms(snippet, query, styles.mark)}
                      timestamp={formatListTimestamp(t.lastMessageAt)}
                      timestampSpoken={relativeTime(t.lastMessageAt)}
                      unread={t.unread}
                      messageCount={t.messages.length}
                      hasAttachment={t.messages.some((m) => m.attachments.length > 0)}
                      isNewlyApproved={false}
                      checked={false}
                      cursor={index === cursor}
                      open={t.id === threadId}
                      place={t.place}
                      online={online}
                      tabIndex={index === cursor ? 0 : -1}
                      onOpen={() => {
                        // Without this the cursor stays where it was, so `e`
                        // archives a thread the user isn't looking at and j/k
                        // jump back to somewhere else entirely.
                        setCursor(index);
                        openResult(t.id);
                      }}
                      onToggleCheck={() => {}}
                      onArchive={() =>
                        void setPlace(t.id, t.place === 'inbox' ? 'archive' : 'inbox')
                      }
                      buttonRef={(el) => {
                        if (el) el.dataset.searchRow = String(index);
                      }}
                    />
                  );
                })}
              </div>
            ))}

            {includeHeld && results.held.length > 0 && (
              <div>
                <h2 className={cn('t-mono-sm', styles.groupHeader)}>HELD</h2>
                {results.held.map((h: HeldSender) => (
                  <button
                    key={h.sender.id}
                    type="button"
                    data-held-row={h.sender.id}
                    className={styles.senderRow}
                    onClick={() => openHeldSheet(h.sender.id)}
                  >
                    <Monogram name={h.sender.name} email={h.sender.email} size={28} />
                    <span className={styles.senderText}>
                      <span className={cn('t-base', 'truncate', styles.senderName)}>
                        {highlightTerms(displayName(h.sender), query, styles.mark)}
                      </span>
                      <span className={cn('t-sm', 'truncate', styles.senderSubject)}>
                        {highlightTerms(h.messages[0].subject, query, styles.mark)}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div className={styles.screen}>
      {(bp !== 'narrow' || !threadId) && listColumn}
      {(bp !== 'narrow' || Boolean(threadId)) && (
        <div className={styles.reader}>
          <ThreadReader
            status={thread ? 'ready' : 'none'}
            thread={thread}
            place={thread?.place ?? 'inbox'}
            selfEmail={account?.email ?? ''}
            online={online}
            breakpoint={bp}
            backLabel="Results"
            onBack={closeResult}
            onArchive={thread ? () => void setPlace(thread.id, 'archive') : undefined}
            summary={summary.hidden || summary.bullets.length === 0 ? undefined : summary.bullets}
            summaryState={summary.state === 'idle' ? undefined : summary.state}
            onRetrySummary={summary.summarize}
            onSummarize={summary.summarize}
            hasProvider={connected}
          />
        </div>
      )}
    </div>
  );
}
