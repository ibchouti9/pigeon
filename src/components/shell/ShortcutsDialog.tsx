import { Dialog } from '../primitives/Dialog';
import { Button } from '../primitives/Button';
import { useUi } from '../../store/ui';
import { cn } from '../../lib/cn';
import styles from './ShortcutsDialog.module.css';

const GROUPS: { title: string; rows: [string, string][] }[] = [
  {
    title: 'Anywhere',
    rows: [
      ['g then i', 'Go to Inbox'],
      ['g then s', 'Go to Screener'],
      ['g then a', 'Go to Archive'],
      ['g then ,', 'Go to Settings'],
      ['/', 'Focus search'],
      ['c', 'Compose'],
      ['?', 'Keyboard shortcuts'],
      ['⌘Z', 'Undo the newest action'],
      ['Esc', 'Close the topmost layer'],
    ],
  },
  {
    title: 'In a list',
    rows: [
      ['j', 'Cursor to next row'],
      ['k', 'Cursor to previous row'],
      ['Enter', 'Open the cursor row'],
      ['e', 'Archive the cursor row'],
      ['x', "Toggle the cursor row's checkbox"],
      ['Shift+J', 'Extend the selection down'],
      ['Shift+K', 'Extend the selection up'],
      ['Home', 'First row'],
      ['End', 'Last row'],
    ],
  },
  {
    title: 'In the Inbox',
    rows: [
      ['0', 'All mail'],
      ['1', 'People'],
      ['2', 'Reading'],
      ['3', 'Offers'],
      ['4', 'Receipts'],
      ['5', 'Alerts'],
    ],
  },
  {
    title: 'In a thread',
    rows: [
      ['r', 'Reply'],
      ['a', 'Reply all'],
      ['f', 'Forward'],
      ['e', 'Archive and open the next thread'],
      ['u', 'Back to the list'],
      ['⌘J', 'Draft with Pigeon'],
      ['⌘Enter', 'Send'],
    ],
  },
  {
    title: 'In Search',
    rows: [
      ['Enter', 'Answer the question from the results'],
      ['↓', 'Move into the results'],
    ],
  },
  {
    title: 'In the Screener',
    rows: [
      ['a', 'Approve sender'],
      ['d', 'Decline sender'],
      ['o', 'Read message'],
      ['j', 'Next card'],
      ['k', 'Previous card'],
      ['b', 'Toggle Stack and Bulk review'],
      ['⌘Z', 'Undo the last decision'],
    ],
  },
];

/** §5.14 — opened with ?, closed with Esc. */
export function ShortcutsDialog() {
  const open = useUi((s) => s.shortcutsOpen);
  const setOpen = useUi((s) => s.setShortcutsOpen);

  return (
    <Dialog
      open={open}
      onClose={() => setOpen(false)}
      title="Keyboard shortcuts"
      wide
      actions={
        <Button variant="secondary" onClick={() => setOpen(false)}>
          Close
        </Button>
      }
    >
      <div className={styles.groups}>
        {GROUPS.map((group) => (
          <section key={group.title}>
            <h3 className={cn('t-mono-sm', styles.groupTitle)}>{group.title.toUpperCase()}</h3>
            <dl className={styles.rows}>
              {group.rows.map(([key, description]) => (
                <div key={key + description} className={styles.row}>
                  <dt>
                    <kbd className={cn('t-mono-sm', styles.key)}>{key}</kbd>
                  </dt>
                  <dd className="t-sm">{description}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </Dialog>
  );
}
