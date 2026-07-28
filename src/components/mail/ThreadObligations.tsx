import { useLedger as useLedgerStore } from '../../store/ledger';
import type { Obligation } from '../../store/ledger';
import { Checkbox } from '../primitives/Field';
import { toast } from '../../store/toast';
import { cn } from '../../lib/cn';
import styles from './ThreadObligations.module.css';

/** What each kind is called where it is read, rather than in a list of its own. */
const LEAD: Record<Obligation['kind'], string> = {
  'needs-you': 'They asked you to',
  'you-promised': 'You said you would',
  'waiting-on': "You're waiting on",
};

/**
 * What this conversation is still asking of you, in the conversation.
 *
 * The Ledger already knows — it read every thread for exactly this and put the
 * answer on a screen of its own. But a list of obligations is a place you go
 * when you remember to, and the moment the answer actually matters is the
 * moment you have the conversation open and are deciding what to do about it.
 * Until now those were the only two states Pigeon had, and neither knew about
 * the other: you could read four messages about a liability cap without any
 * hint that you had promised to decide it by end of day.
 *
 * Nothing is computed here. This is the Ledger's own reading, keyed by thread,
 * shown where it applies — which is also why it costs no model call and
 * appears instantly.
 */
export function ThreadObligations({ threadId }: { threadId: string }) {
  const found = useLedgerStore((s) => s.found[threadId]);
  const done = useLedgerStore((s) => s.done);
  const setDone = useLedgerStore((s) => s.setDone);

  const open = (found ?? []).filter((o) => !done.includes(o.id));
  if (open.length === 0) return null;

  function tick(item: Obligation) {
    setDone(item.id, true);
    // §8.5 item 8, and the Ledger's own reason: the model will not rebuild
    // this row, because the conversation has not changed and its read is
    // cached. Without an undo one mis-tap loses an obligation for good.
    toast.undo(`Marked done: ${item.what}`, 'Undo', () => setDone(item.id, false));
  }

  return (
    <section className={styles.block} aria-label="What this conversation still needs">
      <span className={cn('t-mono-sm', styles.label)}>◆ STILL OPEN</span>
      {open.map((item) => (
        <div key={item.id} className={styles.row}>
          {/*
            Waiting-on is somebody else's move, so there is nothing here for
            the reader to tick off — and a checkbox that means "they replied"
            would be a claim the mailbox can make for itself.
          */}
          {item.kind === 'waiting-on' ? (
            <span className={styles.bullet} aria-hidden="true" />
          ) : (
            <Checkbox
              className={styles.tick}
              checked={false}
              onChange={() => tick(item)}
              aria-label={`Mark done: ${item.what}`}
            />
          )}
          <span className={styles.body}>
            <span className={cn('t-base', styles.what)}>
              <span className={styles.lead}>{LEAD[item.kind]} </span>
              {item.what}
            </span>
            {item.due && <span className={cn('t-xs', styles.due)}>{item.due}</span>}
          </span>
        </div>
      ))}
    </section>
  );
}
