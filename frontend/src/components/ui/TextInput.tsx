import { useId } from 'react';
import type { InputHTMLAttributes, Ref } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/cn';

interface TextInputProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  /** Validation error message; also flips the field into its error style. */
  error?: string;
  /** Guidance shown under the field. Replaced by `error` when one is present. */
  hint?: string;
  /** Marks the field visually and via aria-required. */
  required?: boolean;
  /** Optional leading icon, e.g. Mail/Lock on auth screens. */
  icon?: LucideIcon;
  ref?: Ref<HTMLInputElement>;
}

/**
 * Labelled text input with error state. Uses a real <label> tied by id, marks
 * required fields, and wires aria-invalid / aria-describedby so screen readers
 * announce the error. Accepts a ref so react-hook-form's register() works.
 */
export function TextInput({
  label,
  error,
  hint,
  required,
  icon: Icon,
  id,
  className,
  ref,
  ...props
}: TextInputProps) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const errorId = `${inputId}-error`;
  const description = error ?? hint;

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={inputId} className="text-sm font-medium text-ink">
        {label}
        {required && (
          <span className="text-danger" aria-hidden>
            {' '}
            *
          </span>
        )}
      </label>
      <div className="relative">
        {Icon && (
          <Icon
            aria-hidden
            size={18}
            strokeWidth={2}
            className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted"
          />
        )}
        <input
          id={inputId}
          ref={ref}
          aria-required={required || undefined}
          aria-invalid={error ? true : undefined}
          aria-describedby={description ? errorId : undefined}
          className={cn(
            'w-full rounded-lg border px-3 py-2.5 text-sm outline-none transition-colors',
            'focus:border-brand focus:ring-2 focus:ring-brand/30',
            'disabled:cursor-not-allowed disabled:bg-surface-2 disabled:text-muted',
            error ? 'border-danger' : 'border-input',
            Icon && 'pl-10',
            className,
          )}
          {...props}
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
}
