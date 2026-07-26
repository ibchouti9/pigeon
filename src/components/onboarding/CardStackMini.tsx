import { cn } from '../../lib/cn';
import { Monogram } from '../primitives/Monogram';
import { SkeletonBar } from '../primitives/Feedback';
import styles from './CardStackMini.module.css';

/**
 * O5's static miniature of the Screener card stack (§5.4). Three stacked
 * cards, the top one showing a monogram and two grey text bars. No
 * animation — this is illustration, not a live component.
 */
export function CardStackMini() {
  return (
    <div className={styles.stack} aria-hidden="true">
      <div className={cn(styles.behind, styles.behind2)} />
      <div className={cn(styles.behind, styles.behind1)} />
      <div className={styles.front}>
        <div className={styles.frontHead}>
          <Monogram email="sana@northbound.io" name="Sana Sethi" size={28} />
        </div>
        <div className={styles.bars}>
          <SkeletonBar width="70%" height={12} />
          <SkeletonBar width="45%" height={12} />
        </div>
      </div>
    </div>
  );
}
