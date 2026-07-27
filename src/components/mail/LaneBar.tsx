import { cn } from '../../lib/cn';
import { LANE_LABELS, type Lane } from '../../data/lanes';
import type { LaneFilter } from '../../store/lanes';
import { occupiedLanes } from '../../hooks/useThreadLanes';
import { Chip } from '../primitives/Controls';
import styles from './LaneBar.module.css';

export interface LaneBarProps {
  selected: LaneFilter;
  counts: Record<Lane, number>;
  unread: Record<Lane, number>;
  onSelect: (lane: LaneFilter) => void;
}

/**
 * The chips under the Inbox header.
 *
 * Only lanes holding something get a chip, so an account with no marketing in
 * it never grows an Offers tab, and the row is one line on the day you connect.
 * The count on a chip is its *unread* — the number that answers "is there
 * anything for me in there", which is the only reason to look at a chip at all.
 *
 * All is always first and is where the app starts. Lanes hide nothing: every
 * thread is in All, and turning lanes off in Settings leaves exactly this list.
 *
 * `0` and `1`–`5` switch lanes from the keyboard, on the canonical lane order
 * rather than on which chips happen to be showing — a digit that means Offers
 * today and Receipts tomorrow, because a campaign arrived overnight, is worse
 * than a digit that sometimes does nothing.
 */
export function LaneBar({ selected, counts, unread, onSelect }: LaneBarProps) {
  const lanes = occupiedLanes(counts);
  // One lane means there is nothing to choose between.
  if (lanes.length < 2) return null;

  return (
    <div className={styles.bar} role="group" aria-label="Filter the inbox">
      {/*
        No count on All. The header already carries the unread total two rows
        above it, and six chips in a 380px column is the difference between a
        row that fits and a row that scrolls.
      */}
      <Chip
        kind="filter"
        label="All"
        selected={selected === 'all'}
        onClick={() => onSelect('all')}
      />
      {lanes.map((lane) => (
        <Chip
          key={lane}
          kind="filter"
          label={LANE_LABELS[lane]}
          count={unread[lane] || undefined}
          selected={selected === lane}
          onClick={() => onSelect(lane)}
          className={cn(unread[lane] > 0 && styles.hasUnread)}
        />
      ))}
    </div>
  );
}
