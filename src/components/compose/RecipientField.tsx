import { useId, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Address } from '../../types';
import { Chip } from '../primitives/Controls';
import { Monogram } from '../primitives/Monogram';
import { cn } from '../../lib/cn';
import { displayName } from '../../lib/format';
import { isCompleteAddress, parseAddress } from '../../store/compose';
import styles from './RecipientField.module.css';

const MAX_OPTIONS = 6;

export interface RecipientFieldProps {
  label: string;
  value: Address[];
  onChange: (next: Address[]) => void;
  /** Approved senders plus Google Contacts (§3.5 step 2). */
  contacts: Address[];
  placeholder?: string;
  disabled?: boolean;
  /** Rendered right-aligned in the row — the "Cc Bcc" text button. */
  trailing?: ReactNode;
  autoFocus?: boolean;
}

/** C-24 combobox pattern: the input owns the ARIA, the rows are options. */
export function RecipientField({
  label,
  value,
  onChange,
  contacts,
  placeholder,
  disabled,
  trailing,
  autoFocus,
}: RecipientFieldProps) {
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listboxId = useId();

  const options = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length === 0) return [];
    const chosen = new Set(value.map((a) => a.email.toLowerCase()));
    return contacts
      .filter(
        (c) =>
          !chosen.has(c.email.toLowerCase()) &&
          (c.name.toLowerCase().includes(q) || c.email.toLowerCase().includes(q)),
      )
      .slice(0, MAX_OPTIONS);
  }, [query, contacts, value]);

  function commit(address: Address) {
    onChange([...value, address]);
    setQuery('');
    setActiveIndex(0);
  }

  function commitTyped() {
    const trimmed = query.trim().replace(/[,;]$/, '');
    if (!trimmed) return;
    commit(parseAddress(trimmed));
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown' && options.length) {
      setActiveIndex((i) => (i + 1) % options.length);
      e.preventDefault();
    } else if (e.key === 'ArrowUp' && options.length) {
      setActiveIndex((i) => (i - 1 + options.length) % options.length);
      e.preventDefault();
    } else if (e.key === 'Enter') {
      if (options.length) commit(options[activeIndex]);
      else commitTyped();
      e.preventDefault();
    } else if (e.key === ',' || e.key === ';' || (e.key === 'Tab' && query.trim())) {
      commitTyped();
      if (e.key !== 'Tab') e.preventDefault();
    } else if (e.key === 'Escape' && options.length) {
      setQuery('');
      e.stopPropagation();
    } else if (e.key === 'Backspace' && query === '' && value.length) {
      onChange(value.slice(0, -1));
    }
  }

  return (
    <div className={styles.row}>
      <span className={cn('t-sm', styles.label)} id={`${listboxId}-label`}>
        {label}
      </span>

      <div className={styles.field}>
        {value.map((address, i) => (
          <Chip
            key={`${address.email}-${i}`}
            kind="recipient"
            label={displayName(address)}
            invalid={!isCompleteAddress(address.email)}
            onRemove={() => onChange(value.filter((_, j) => j !== i))}
          />
        ))}

        <input
          ref={inputRef}
          className={cn('t-base', styles.input)}
          value={query}
          placeholder={value.length === 0 ? placeholder : undefined}
          disabled={disabled}
          autoFocus={autoFocus}
          autoComplete="off"
          spellCheck={false}
          role="combobox"
          aria-expanded={options.length > 0}
          aria-controls={listboxId}
          aria-labelledby={`${listboxId}-label`}
          aria-activedescendant={
            options.length ? `${listboxId}-option-${activeIndex}` : undefined
          }
          onChange={(e) => {
            setQuery(e.currentTarget.value);
            setActiveIndex(0);
          }}
          onBlur={commitTyped}
          onKeyDown={onKeyDown}
        />
      </div>

      {trailing && <div className={styles.trailing}>{trailing}</div>}

      {options.length > 0 && (
        <ul className={styles.listbox} id={listboxId} role="listbox">
          {options.map((option, i) => (
            <li
              key={option.email}
              id={`${listboxId}-option-${i}`}
              role="option"
              aria-selected={i === activeIndex}
              className={cn(styles.option, i === activeIndex && styles.optionActive)}
              onMouseEnter={() => setActiveIndex(i)}
              onMouseDown={(e) => {
                e.preventDefault();
                commit(option);
              }}
            >
              <Monogram name={option.name} email={option.email} size={24} />
              <span className={cn('t-sm', styles.optionName)}>{displayName(option)}</span>
              <span className={cn('t-xs', 'truncate', styles.optionEmail)}>{option.email}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
