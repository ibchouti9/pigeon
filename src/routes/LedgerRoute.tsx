import { useNavigate } from 'react-router-dom';
import { useLedger, useMailboxThreads } from '../ai/useLedger';
import { useLedger as useLedgerStore, type Obligation } from '../store/ledger';
import { useAssistant } from '../ai/useAssistant';
import { Checkbox } from '../components/primitives/Field';
import { EmptyState } from '../components/primitives/Feedback';
import { toast } from '../store/toast';
import { cn } from '../lib/cn';
import { plural } from '../lib/format';
import styles from './LedgerRoute.module.css';

/**
 * What the mail is asking of you.
 *
 * Every other assistant surface in Pigeon is reactive: it summarizes the
 * thread you opened, sorts the mail that arrived, answers the question you
 * typed. This one notices. It is the difference between a model in a mail
 * client and a mail client with an agent in it.
 *
 * Nothing here is a mail action. Ticking a row off is a note to yourself that
 * you have dealt with something — it does not archive the thread, reply to it,
 * or tell anyone anything. That keeps the ledger safe to be wrong: a bad row
 * costs a tick, not a message.
 */

const GROUPS: { key: keyof Pick<ReturnType<typeof useLedger>, 'needsYou' | 'youPromised' | 'waitingOn'>; title: string; note: string }[] = [
  {
    key: 'needsYou',
    title: 'Needs you',
    note: 'Someone asked you for something and has not had it.',
  },
  {
    key: 'youPromised',
    title: 'You promised',
    note: "Things you said you would do, and haven't said are done.",
  },
  {
    key: 'waitingOn',
    title: 'Waiting on',
    note: 'You asked, and no one has come back to you.',
  },
];

function Row({ item, onOpen }: { item: Obligation; onOpen: () => void }) {
  const setDone = useLedgerStore((s) => s.setDone);

  /*
   * §8.5 item 8 — undo or confirm, never neither.
   *
   * Ticking a row off removes it from a list the model built, and the model
   * will not rebuild it: the conversation has not changed, so the cached read
   * stands and the row does not come back. Without an undo, one mis-click
   * loses an obligation silently and permanently, which is the one thing a
   * ledger must not do.
   */
  function tick() {
    setDone(item.id, true);
    toast.undo(`Marked done: ${item.what}`, 'Undo', () => setDone(item.id, false));
  }

  return (
    <div className={styles.row}>
      <span className={styles.tick}>
        <Checkbox
          checked={false}
          onChange={tick}
          aria-label={`Mark done: ${item.what}`}
        />
      </span>
      <span className={styles.rowBody}>
        <span className={cn('t-base', styles.what)}>{item.what}</span>
        <span className={cn('t-xs', styles.meta)}>
          <span>{item.who}</span>
          {item.due && (
            <>
              <span aria-hidden="true">·</span>
              {/* The one thing on the row worth finding at a glance, and copied
                  from the mail rather than parsed — "before the renewal" is a
                  deadline and is not a date. */}
              <span className={styles.due}>{item.due}</span>
            </>
          )}
        </span>
      </span>
      <button type="button" className={cn('t-xs', styles.open)} onClick={onOpen}>
        Open
      </button>
    </div>
  );
}

export function LedgerRoute() {
  const navigate = useNavigate();
  const { connected } = useAssistant();

  const threads = useMailboxThreads();
  const ledger = useLedger(threads);
  const total = ledger.needsYou.length + ledger.youPromised.length + ledger.waitingOn.length;

  return (
    <div className={styles.screen}>
      <div className={styles.header}>
        <h1 className="t-display-sm" tabIndex={-1}>
          Ledger
        </h1>
        {ledger.thinking && (
          <span className={cn('t-xs', styles.progress)} role="status">
            Reading your mail — {ledger.read} of {ledger.total}
          </span>
        )}
      </div>

      <div className={styles.body}>
        {!connected ? (
          <div className={styles.empty}>
            <EmptyState
              headline="The ledger needs a model."
              body="Pigeon reads your conversations for what is still outstanding. Connect a model in Settings and it will start."
            />
          </div>
        ) : total === 0 ? (
          <div className={styles.empty}>
            <EmptyState
              headline={ledger.thinking ? 'Reading your mail.' : 'Nothing outstanding.'}
              body={
                ledger.thinking
                  ? 'Pigeon is going through your conversations for anything still open.'
                  : 'No one is waiting on you, and you are not waiting on anyone.'
              }
            />
          </div>
        ) : (
          GROUPS.map((group) => {
            const items = ledger[group.key];
            if (items.length === 0) return null;
            return (
              <section key={group.key} className={styles.group}>
                <div className={styles.groupHead}>
                  <h2 className="t-base">{group.title}</h2>
                  <span className={cn('t-xs', styles.progress)}>
                    {plural(items.length, 'item')}
                  </span>
                </div>
                <span className={cn('t-xs', styles.groupNote)}>{group.note}</span>
                <div className={styles.list}>
                  {items.map((item) => (
                    <Row
                      key={item.id}
                      item={item}
                      onOpen={() => navigate(`/inbox/t/${item.threadId}`)}
                    />
                  ))}
                </div>
              </section>
            );
          })
        )}
      </div>
    </div>
  );
}
