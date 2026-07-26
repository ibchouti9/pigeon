import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';
import styles from './OnboardingColumn.module.css';

/**
 * Shared shell for every onboarding screen (§3.1). Onboarding has no shell
 * and no nav rail — this is the entire chrome. Vertically centered with a
 * minimum top offset, horizontally centered, width per-screen (§5.1–§5.4).
 */
export function OnboardingColumn({
  width,
  children,
  className,
}: {
  /** Column max-width in px. Defaults to --layout-onboarding-width (480). */
  width?: number;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={styles.page}>
      <div className={cn(styles.column, className)} style={width ? { maxWidth: width } : undefined}>
        {children}
      </div>
    </div>
  );
}
