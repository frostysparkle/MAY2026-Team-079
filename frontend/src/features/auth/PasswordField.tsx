import { useId, useState } from 'react';
import { Eye, EyeOff, Lock } from 'lucide-react';
import { cn } from '@/lib/cn';

/**
 * Password input with a lock affix and a reveal toggle. Shared by every screen
 * that asks for a password so the control behaves and reads identically
 * everywhere. The toggle is a real button with an accessible name, and
 * `hint`/`error` are wired through aria-describedby.
 */
export function PasswordField({
  label,
  value,
  onChange,
  autoComplete,
  placeholder,
  hint,
  error,
  minLength,
  disabled,
  required = true,
  id,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: 'current-password' | 'new-password';
  placeholder?: string;
  hint?: string;
  error?: string;
  minLength?: number;
  disabled?: boolean;
  required?: boolean;
  id?: string;
}) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const describedById = `${inputId}-description`;
  const [visible, setVisible] = useState(false);
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
        <Lock
          aria-hidden
          size={18}
          strokeWidth={2}
          className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted"
        />
        <input
          id={inputId}
          type={visible ? 'text' : 'password'}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          autoComplete={autoComplete}
          placeholder={placeholder}
          required={required}
          aria-required={required || undefined}
          aria-invalid={error ? true : undefined}
          aria-describedby={description ? describedById : undefined}
          minLength={minLength}
          disabled={disabled}
          className={cn(
            'w-full rounded-lg border bg-surface py-2.5 pl-10 pr-11 text-sm outline-none transition-colors',
            'focus:border-brand focus:ring-2 focus:ring-brand/30',
            'disabled:cursor-not-allowed disabled:bg-surface-2 disabled:text-muted',
            error ? 'border-danger' : 'border-input',
          )}
        />
        <button
          type="button"
          onClick={() => setVisible((current) => !current)}
          aria-label={visible ? 'Hide password' : 'Show password'}
          className="tap absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-ink"
        >
          {visible ? <EyeOff size={18} strokeWidth={2} /> : <Eye size={18} strokeWidth={2} />}
        </button>
      </div>
      {description && (
        <p
          id={describedById}
          role={error ? 'alert' : undefined}
          className={cn('text-xs', error ? 'text-danger' : 'text-muted')}
        >
          {description}
        </p>
      )}
    </div>
  );
}

/** Shared rule so every password entry point states the same requirement. */
export const MIN_PASSWORD_LENGTH = 8;
export const PASSWORD_HINT = `At least ${MIN_PASSWORD_LENGTH} characters.`;
