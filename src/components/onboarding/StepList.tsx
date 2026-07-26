import { cn } from '../../lib/cn';
import { Icon } from '../primitives/Icon';
import styles from './StepList.module.css';

export type StepState = 'done' | 'current' | 'pending';

export interface Step {
  key: string;
  label: string;
  state: StepState;
}

/** O3 step list — 4 rows, 16px glyph + label (§5.2b). */
export function StepList({ steps }: { steps: Step[] }) {
  return (
    <ul className={styles.list}>
      {steps.map((s) => (
        <li key={s.key} className={cn('t-sm', styles.row, s.state === 'pending' && styles.rowPending)}>
          <span className={styles.glyph} aria-hidden="true">
            {s.state === 'done' && <Icon name="check" size={16} className={styles.check} />}
            {s.state === 'current' && <span className={styles.ringCurrent} />}
            {s.state === 'pending' && <span className={styles.ringPending} />}
          </span>
          {s.label}
        </li>
      ))}
    </ul>
  );
}
