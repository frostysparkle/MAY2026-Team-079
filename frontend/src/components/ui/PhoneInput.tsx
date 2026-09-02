import { useId, useMemo, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/cn';
import {
  DEFAULT_PHONE_ISO,
  PHONE_COUNTRY_OPTIONS,
  countryByIso,
  digitsOnly,
  formatPhone,
  lengthHint,
  parsePhone,
} from '@/lib/phone';

export interface PhoneInputProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  error?: string;
  hint?: string;
  required?: boolean;
  disabled?: boolean;
  autoComplete?: string;
  /** Used when `value` has no country yet. India is the product default. */
  defaultIso?: string;
  id?: string;
  className?: string;
}

/**
 * Country calling code + national number, with the national field capped at
 * that country's digit limit. Emits the canonical `+{code} {national}` string
 * the backend validates, or `''` while the national side is still empty so a
 * required field does not look filled in from the country picker alone.
 */
export function PhoneInput({
  label,
  value,
  onChange,
  onBlur,
  error,
  hint,
  required,
  disabled,
  autoComplete = 'tel',
  defaultIso = DEFAULT_PHONE_ISO,
  id,
  className,
}: PhoneInputProps) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const selectId = `${inputId}-country`;
  const errorId = `${inputId}-error`;

  const parsed = parsePhone(value);
  const [pickedIso, setPickedIso] = useState(() => parsed?.country.iso ?? defaultIso);
  const iso = parsed?.country.iso ?? pickedIso;
  const country = countryByIso(iso) ?? countryByIso(defaultIso);
  const national = parsed?.national ?? (value.trim() ? digitsOnly(value) : '');

  const description =
    error ?? hint ?? (country ? `${lengthHint(country)} for ${country.name}` : undefined);

  const options = useMemo(() => PHONE_COUNTRY_OPTIONS, []);

  function emit(nextIso: string, nextNational: string) {
    const nextCountry = countryByIso(nextIso) ?? countryByIso(defaultIso);
    if (!nextCountry) {
      onChange('');
      return;
    }
    const capped = nextNational.slice(0, nextCountry.max);
    setPickedIso(nextCountry.iso);
    onChange(capped ? formatPhone(nextCountry, capped) : '');
  }

  function onNationalChange(raw: string) {
    const trimmed = raw.trim();
    if (trimmed.startsWith('+') || trimmed.startsWith('00')) {
      const pasted = parsePhone(trimmed);
      if (pasted) {
        emit(pasted.country.iso, pasted.national);
        return;
      }
    }
    emit(iso, digitsOnly(raw));
  }

  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <label htmlFor={inputId} className="text-sm font-medium text-ink">
        {label}
        {required && (
          <span className="text-danger" aria-hidden>
            {' '}
            *
          </span>
        )}
      </label>
      <div className="flex gap-2">
        <div className="relative w-[11.5rem] shrink-0">
          <select
            id={selectId}
            aria-label={`${label} country code`}
            disabled={disabled}
            value={country?.iso ?? defaultIso}
            onChange={(e) => emit(e.target.value, national)}
            onBlur={onBlur}
            className={cn(
              'w-full appearance-none rounded-lg border bg-surface py-2.5 pl-3 pr-8 text-sm outline-none transition-colors',
              'focus:border-brand focus:ring-2 focus:ring-brand/30',
              'disabled:cursor-not-allowed disabled:bg-surface-2 disabled:text-muted',
              error ? 'border-danger' : 'border-input',
            )}
          >
            {options.map((option) => (
              <option key={option.iso} value={option.iso}>
                +{option.callingCode} · {option.name}
              </option>
            ))}
          </select>
          <ChevronDown
            aria-hidden
            size={16}
            className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-muted"
          />
        </div>
        <input
          id={inputId}
          type="tel"
          inputMode="numeric"
          autoComplete={autoComplete}
          disabled={disabled}
          required={required}
          aria-required={required || undefined}
          aria-invalid={error ? true : undefined}
          aria-describedby={description ? errorId : undefined}
          value={national}
          maxLength={country?.max}
          placeholder={country ? lengthHint(country) : undefined}
          onChange={(e) => onNationalChange(e.target.value)}
          onBlur={onBlur}
          className={cn(
            'min-w-0 flex-1 rounded-lg border px-3 py-2.5 text-sm outline-none transition-colors',
            'focus:border-brand focus:ring-2 focus:ring-brand/30',
            'disabled:cursor-not-allowed disabled:bg-surface-2 disabled:text-muted',
            error ? 'border-danger' : 'border-input',
          )}
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
