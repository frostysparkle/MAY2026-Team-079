import { forwardRef, useId } from 'react';
import type { SelectHTMLAttributes } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/cn';

export interface SelectOption {
  value: string;
  label: string;
}

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label: string;
  options: SelectOption[];
  error?: string;
  /** Guidance shown under the field. Replaced by `error` when one is present. */
  hint?: string;
  required?: boolean;
  placeholder?: string;
}

/**
 * Labelled select with the same accessibility treatment as TextInput (real
 * label, required marking, aria-invalid/describedby). Forwards ref for RHF.
 */
export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { label, options, error, hint, required, placeholder, id, className, ...props },
  ref,
) {
  const autoId = useId();
  const selectId = id ?? autoId;
  const errorId = `${selectId}-error`;
  const description = error ?? hint;

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={selectId} className="text-sm font-medium text-ink">
        {label}
        {required && (
          <span className="text-danger" aria-hidden>
            {' '}
            *
          </span>
        )}
      </label>
      <div className="relative">
        <select
          id={selectId}
          ref={ref}
          aria-required={required || undefined}
          aria-invalid={error ? true : undefined}
          aria-describedby={description ? errorId : undefined}
          className={cn(
            'w-full appearance-none rounded-lg border bg-surface px-3 py-2.5 pr-9 text-sm outline-none transition-colors',
            'focus:border-brand focus:ring-2 focus:ring-brand/30',
            error ? 'border-danger' : 'border-input',
            className,
          )}
          {...props}
        >
          {placeholder && <option value="">{placeholder}</option>}
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <ChevronDown
          aria-hidden
          size={16}
          className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted"
        />
      </div>
      {description && (
        <p
          id={errorId}
          role={error ? 'alert' : undefined}
          className={cn('text-xs', error ? 'text-danger' : 'text-muted')}
        >
          {description}
        </p>
      )}
    </div>
  );
});
