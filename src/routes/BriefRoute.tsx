import { useNavigate } from 'react-router-dom';
import { useMail, useHeldCount } from '../store/mail';
import { useLedger, useMailboxThreads } from '../ai/useLedger';
import { useAssistant } from '../ai/useAssistant';
import { EmptyState } from '../components/primitives/Feedback';
import { cn } from '../lib/cn';
import { plural } from '../lib/format';
import type { Thread } from '../types';
import styles from './BriefRoute.module.css';

/**
 * The mailbox in one page.
 *
 * Composed, not generated: every number here is counted and every line is a
 * ledger row or a thread that exists. A model writing prose *about* the
 * mailbox would be a paragraph nobody can check, and the one failure this
 * screen cannot afford is being confidently wrong about a quiet morning.
 *
 * The model's contribution is upstream — it is what turned twenty threads into
 * three obligations. This arranges them.
 */

/** Since the start of yesterday: what a person means by "what came in". */
function arrivedRecently(thread: Thread): boolean {
  const cutoff = new Date();
  cutoff.setHours(0, 0, 0, 0);
  cutoff.setDate(cutoff.getDate() - 1);
  return new Date(thread.lastMessageAt) >= cutoff;
}

function today(): string {
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(new Date());
}

export function BriefRoute() {
  const navigate = useNavigate();
  const inbox = useMail((s) => s.inbox);
  const held = useHeldCount();
  const { connected } = useAssistant();

  const threads = useMailboxThreads();
  const ledger = useLedger(threads);

  const fresh = inbox.filter(arrivedRecently);
  const unread = inbox.filter((t) => t.unread);
  const dated = ledger.needsYou.filter((o) => o.due);
  const openCount =
    ledger.needsYou.length + ledger.youPromised.length + ledger.waitingOn.length;

  /*
   * One sentence of arithmetic. It says only what was counted — a brief that
   * opens with a claim the page below contradicts is worse than no brief.
   */
  const lede = [
    `${plural(fresh.length, 'conversation')} since yesterday`,
    unread.length > 0 ? `${unread.length} still unread` : null,
    held > 0 ? `${plural(held, 'sender')} waiting in the Screener` : null,
    openCount > 0 ? `${plural(openCount, 'thing')} still open` : null,
  ]
    .filter(Boolean)
    .join(', ');

  const nothing = fresh.length === 0 && openCount === 0 && held === 0;

  return (
    <div className={styles.screen}>
      <div className={styles.header}>
        <h1 className="t-display-sm" tabIndex={-1}>
          Today
        </h1>
        <span className={cn('t-xs', styles.date)}>{today()}</span>
      </div>

      <div className={styles.body}>
        {nothing ? (
          <div className={styles.empty}>
            <EmptyState
              headline="Nothing waiting."
              body={
                connected
                  ? 'No new mail since yesterday, nobody in the Screener, and nothing outstanding.'
                  : 'No new mail since yesterday, and nobody in the Screener.'
              }
            />
          </div>
        ) : (
          <>
            <p className={cn('t-md', styles.lede)}>{lede}.</p>

            {dated.length > 0 && (
              <section className={styles.section}>
                <div className={styles.sectionHead}>
                  <h2 className="t-base">Has a date on it</h2>
                  <span className={cn('t-xs', styles.count)}>{dated.length}</span>
                </div>
                <div className={styles.list}>
                  {dated.map((o) => (
                    <button
                      key={o.id}
                      type="button"
                      className={cn('t-sm', styles.item)}
                      onClick={() => navigate(`/inbox/t/${o.threadId}`)}
                    >
                      <span className={styles.who}>{o.who}</span>
                      <span className={styles.what}>{o.what}</span>
                      <span className={cn('t-xs', styles.due)}>{o.due}</span>
                    </button>
                  ))}
                </div>
              </section>
            )}

            {ledger.waitingOn.length > 0 && (
              <section className={styles.section}>
                <div className={styles.sectionHead}>
                  <h2 className="t-base">Nobody has come back to you</h2>
                  <span className={cn('t-xs', styles.count)}>{ledger.waitingOn.length}</span>
                </div>
                <div className={styles.list}>
                  {ledger.waitingOn.map((o) => (
                    <button
                      key={o.id}
                      type="button"
                      className={cn('t-sm', styles.item)}
                      onClick={() => navigate(`/inbox/t/${o.threadId}`)}
                    >
                      <span className={styles.who}>{o.who}</span>
                      <span className={styles.what}>{o.what}</span>
                    </button>
                  ))}
                </div>
              </section>
            )}

            {fresh.length > 0 && (
              <section className={styles.section}>
                <div className={styles.sectionHead}>
                  <h2 className="t-base">Since yesterday</h2>
                  <span className={cn('t-xs', styles.count)}>{fresh.length}</span>
                </div>
                <div className={styles.list}>
                  {fresh.slice(0, 8).map((t) => {
                    const from = [...t.messages].reverse().find((m) => !m.isFromUser)?.from;
                    return (
                      <button
                        key={t.id}
                        type="button"
                        className={cn('t-sm', styles.item)}
                        onClick={() => navigate(`/inbox/t/${t.id}`)}
                      >
                        <span className={styles.who}>{from?.name || from?.email || 'Unknown'}</span>
                        <span className={styles.what}>{t.subject}</span>
                      </button>
                    );
                  })}
                </div>
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
}
