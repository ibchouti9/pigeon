import { cn } from '../../lib/cn';
import { initialsFor, monogramTone } from '../../lib/monogram';
import styles from './Monogram.module.css';

export interface MonogramProps {
  name?: string;
  email: string;
  size?: 20 | 24 | 28 | 40;
  className?: string;
}

/**
 * C-3 Monogram tile. Decorative — the name is always adjacent in text (D16),
 * so the tile is aria-hidden.
 */
export function Monogram({ name, email, size = 28, className }: MonogramProps) {
  const tone = monogramTone(email);
  return (
    <span
      aria-hidden="true"
      className={cn(styles.tile, className)}
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.4),
        background: `var(--monogram-${tone})`,
      }}
    >
      {initialsFor(name, email)}
    </span>
  );
}
