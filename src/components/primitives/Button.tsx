import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cn } from '../../lib/cn';
import styles from './Button.module.css';

export type ButtonVariant =
  | 'primary'
  | 'secondary'
  | 'secondary-destructive'
  | 'tertiary'
  | 'icon';

export type ButtonSize = 'md' | 'sm' | 'xs';

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary: styles.primary,
  secondary: styles.secondary,
  'secondary-destructive': styles.secondaryDestructive,
  tertiary: styles.tertiary,
  icon: styles.icon,
};

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  iconLeading?: ReactNode;
  iconTrailing?: ReactNode;
  fullWidth?: boolean;
  loading?: boolean;
  children?: ReactNode;
}

/** C-1 Button. `loading` sets aria-busy and disables (never changes the label). */
export function Button({
  variant = 'secondary',
  size = 'md',
  iconLeading,
  iconTrailing,
  fullWidth,
  loading,
  disabled,
  className,
  children,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        styles.button,
        VARIANT_CLASS[variant],
        styles[size],
        fullWidth && styles.fullWidth,
        className,
      )}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <span className={styles.spinner} aria-hidden="true" /> : iconLeading}
      {children}
      {iconTrailing}
    </button>
  );
}
