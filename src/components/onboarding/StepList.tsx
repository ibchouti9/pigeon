import { cn } from '../../lib/cn';
import { Icon } from '../primitives/Icon';
import styles from './StepList.module.css';

export type StepState = 'done' | 'current' | 'pending';

export interface Step {
  key: string;
  label: string;
  state: StepState;
}

/** §8.4 — the glyph is decorative, so the state needs saying in words. */
const SPOKEN: Record<StepState, string> = {
  done: 'done',
  current: 'in progress',
  pending: 'not started',
};

/**
 * O3 step list — 4 rows, 16px glyph + label (§5.2b). An `<ol>`, per §8.4: the
 * steps run in a fixed order and a screen reader should say which number it is
 * on. As a `<ul>` with an aria-hidden glyph, the state was carried by shape and
 * colour alone and did not reach assistive tech at all.
 */
export function StepList({ steps }: { steps: Step[] }) {
  return (
    <ol className={styles.list}>
      {steps.map((s) => (
        <li key={s.key} className={cn('t-sm', styles.row, s.state === 'pending' && styles.rowPending)}>
          <span className={styles.glyph} aria-hidden="true">
            {s.state === 'done' && <Icon name="check" size={16} className={styles.check} />}
            {s.state === 'current' && <span className={styles.ringCurrent} />}
            {s.state === 'pending' && <span className={styles.ringPending} />}
          </span>
          {s.label}
          <span className="visually-hidden">{` — ${SPOKEN[s.state]}`}</span>
        </li>
      ))}
    </ol>
  );
}
