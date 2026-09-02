import { useId, useMemo, useState, type ChangeEvent, type ClipboardEvent } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/cn';
import {
  DEFAULT_PHONE_ISO,
  INDIA,
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
 *
 * Extra digits are clipped in the event handler (and `maxLength` on the input)
 * because a parent that already holds the capped value will not re-render, and
 * `type="tel"` ignores `maxLength` in some browsers.
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
  const country = countryByIso(iso) ?? countryByIso(defaultIso) ?? INDIA;
  const maxDigits = country.max;
  const national = (parsed?.national ?? (value.trim() ? digitsOnly(value) : '')).slice(
    0,
    maxDigits,
  );

  const description = error ?? hint ?? `${lengthHint(country)} for ${country.name}`;

  const options = useMemo(() => PHONE_COUNTRY_OPTIONS, []);

  function emit(nextIso: string, nextNational: string) {
    const nextCountry = countryByIso(nextIso) ?? countryByIso(defaultIso) ?? INDIA;
    const capped = digitsOnly(nextNational).slice(0, nextCountry.max);
    setPickedIso(nextCountry.iso);
    onChange(capped ? formatPhone(nextCountry, capped) : '');
    return capped;
  }

  function onNationalChange(e: ChangeEvent<HTMLInputElement>) {
    const raw = e.target.value;
    const trimmed = raw.trim();
    if (trimmed.startsWith('+') || trimmed.startsWith('00')) {
      const pasted = parsePhone(trimmed);
      if (pasted) {
        const capped = emit(pasted.country.iso, pasted.national);
        e.target.value = capped;
        return;
      }
    }
    const capped = emit(iso, raw);
    // Clip even when the parent value did not change (already at the limit),
    // otherwise React skips the render and the extra digit stays in the box.
    e.target.value = capped;
  }

  function onPaste(e: ClipboardEvent<HTMLInputElement>) {
    const text = e.clipboardData.getData('text');
    if (!text) return;
    e.preventDefault();
    const trimmed = text.trim();
    if (trimmed.startsWith('+') || trimmed.startsWith('00')) {
      const pasted = parsePhone(trimmed);
      if (pasted) {
        emit(pasted.country.iso, pasted.national);
        return;
      }
    }
    const el = e.currentTarget;
    const start = el.selectionStart ?? 0;
    const end = el.selectionEnd ?? el.value.length;
    emit(iso, `${el.value.slice(0, start)}${text}${el.value.slice(end)}`);
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
            value={country.iso}
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
          type="text"
          inputMode="numeric"
          autoComplete={autoComplete}
          disabled={disabled}
          required={required}
          aria-required={required || undefined}
          aria-invalid={error ? true : undefined}
          aria-describedby={description ? errorId : undefined}
          value={national}
          maxLength={maxDigits}
          pattern="[0-9]*"
          placeholder={lengthHint(country)}
          onChange={onNationalChange}
          onPaste={onPaste}
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
