import { forwardRef, useId, type InputHTMLAttributes } from 'react';
import { cn } from '../../lib/cn';
import styles from './Field.module.css';

/* -------------------------------------------------------------------------- */
/* C-13 Input                                                                  */
/* -------------------------------------------------------------------------- */

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  label?: string;
  helperText?: string;
  invalid?: boolean;
  size?: 'md' | 'sm' | 'xs';
  mono?: boolean;
  /** Hides the visible label but keeps it as the accessible name. */
  hideLabel?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, helperText, invalid, size = 'md', mono, hideLabel, className, id, ...rest },
  ref,
) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const helperId = `${inputId}-helper`;

  return (
    <div className={className}>
      {label && (
        <label
          htmlFor={inputId}
          className={cn('t-sm', styles.label, hideLabel && 'visually-hidden')}
        >
          {label}
        </label>
      )}
      <input
        ref={ref}
        id={inputId}
        className={cn(
          't-base',
          styles.input,
          styles[size],
          mono && styles.mono,
          invalid && styles.invalid,
        )}
        aria-invalid={invalid || undefined}
        aria-describedby={helperText ? helperId : undefined}
        {...rest}
      />
      {helperText && (
        <p
          id={helperId}
          className={cn('t-xs', styles.helper, invalid && styles.helperInvalid)}
        >
          {helperText}
        </p>
      )}
    </div>
  );
});

/* -------------------------------------------------------------------------- */
/* C-14 Checkbox — native input with a styled pseudo-element, never a div.      */
/* -------------------------------------------------------------------------- */

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  indeterminate?: boolean;
}

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox(
  { indeterminate, className, ...rest },
  ref,
) {
  return (
    <input
      ref={(node) => {
        if (node) node.indeterminate = Boolean(indeterminate);
        if (typeof ref === 'function') ref(node);
        else if (ref) ref.current = node;
      }}
      type="checkbox"
      className={cn(styles.checkbox, className)}
      {...rest}
    />
  );
});

/* -------------------------------------------------------------------------- */
/* C-15 Switch                                                                 */
/* -------------------------------------------------------------------------- */

export interface SwitchProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  'aria-label'?: string;
  'aria-labelledby'?: string;
  'aria-describedby'?: string;
  className?: string;
}

export function Switch({ checked, onChange, disabled, className, ...aria }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-disabled={disabled || undefined}
      disabled={disabled}
      className={cn(styles.switch, className)}
      onClick={() => !disabled && onChange(!checked)}
      {...aria}
    />
  );
}
