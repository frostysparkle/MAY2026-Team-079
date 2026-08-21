import { useId } from 'react';
import type { Ref, TextareaHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

interface TextAreaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label: string;
  /** Validation error message; also flips the field into its error style. */
  error?: string;
  /** Guidance shown under the field. Replaced by `error` when one is present. */
  hint?: string;
  /** Marks the field visually and via aria-required. */
  required?: boolean;
  ref?: Ref<HTMLTextAreaElement>;
}

/**
 * The multi-line counterpart of `TextInput` — same label, same required marking,
 * same border and focus ring, same describedby wiring.
 *
 * It exists because the two long-form fields in the participant area, "Your
 * question" on the Ask tab and "What is wrong?" on the Report tab, were each
 * written out by hand against `TextInput`'s classes from memory. They ended up
 * with different label markup, different describedby ids, one resizable and one
 * not, and neither of them matching the `TextInput` sitting directly above it in
 * the same form. A form control is exactly the kind of thing that has to be one
 * component.
 */
export function TextArea({
  label,
  error,
  hint,
  required,
  id,
  rows = 5,
  className,
  ref,
  ...props
}: TextAreaProps) {
  const autoId = useId();
  const areaId = id ?? autoId;
  const errorId = `${areaId}-error`;
  const description = error ?? hint;

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={areaId} className="text-sm font-medium text-ink">
        {label}
        {required && (
          <span className="text-danger" aria-hidden>
            {' '}
            *
          </span>
        )}
      </label>
      <textarea
        id={areaId}
        ref={ref}
        rows={rows}
        aria-required={required || undefined}
        aria-invalid={error ? true : undefined}
        aria-describedby={description ? errorId : undefined}
        className={cn(
          'w-full resize-y rounded-lg border px-3 py-2.5 text-sm outline-none transition-colors',
          'focus:border-brand focus:ring-2 focus:ring-brand/30',
          'disabled:cursor-not-allowed disabled:bg-surface-2 disabled:text-muted',
          error ? 'border-danger' : 'border-input',
          className,
        )}
        {...props}
      />
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
