import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';
import styles from './SettingsPage.module.css';

export interface SettingsPageProps {
  children: ReactNode;
  /**
   * Opts the page out of page-level scrolling when it manages its own
   * internal scroll region instead (Senders' virtualized list).
   */
  noScroll?: boolean;
  className?: string;
}

/**
 * Shared shell for every /settings/* page — content column, max-width
 * 720px, left-aligned with `--space-8` gutters (§5.13).
 */
export function SettingsPage({ children, noScroll, className }: SettingsPageProps) {
  return (
    <div className={cn(styles.page, noScroll && styles.noScroll)}>
      <div className={cn(styles.inner, noScroll && styles.innerNoScroll, className)}>
        {children}
      </div>
    </div>
  );
}
