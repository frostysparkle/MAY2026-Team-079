import { forwardRef, useId } from 'react';
import type { InputHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

interface TextInputProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  /** Validation error message; also flips the field into its error style. */
  error?: string;
  /** Marks the field visually and via aria-required. */
  required?: boolean;
}

/**
 * Labelled text input with error state. Uses a real <label> tied by id, marks
 * required fields, and wires aria-invalid / aria-describedby so screen readers
 * announce the error. Forwards its ref so react-hook-form's register() works.
 */
export const TextInput = forwardRef<HTMLInputElement, TextInputProps>(function TextInput(
  { label, error, required, id, className, ...props },
  ref,
) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const errorId = `${inputId}-error`;

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={inputId} className="text-sm font-medium text-gray-700">
        {label}
        {required && (
          <span className="text-danger" aria-hidden>
            {' '}
            *
          </span>
        )}
      </label>
      <input
        id={inputId}
        ref={ref}
        aria-required={required || undefined}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        className={cn(
          'rounded-lg border px-3 py-2.5 text-sm outline-none transition-colors',
          'focus:border-brand focus:ring-2 focus:ring-brand/30',
          error ? 'border-danger' : 'border-line',
          className,
        )}
        {...props}
      />
      {error && (
        <p id={errorId} role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
});
