import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/cn';

/**
 * Segmented control for switching how a collection is laid out — a table for
 * comparing figures across rows, cards for scanning one block at a time.
 *
 * Built as a radiogroup rather than a set of toggle buttons: the options are
 * mutually exclusive, so arrow keys should move between them and only the
 * selected one should be a tab stop.
 */

export interface ViewOption<T extends string> {
  value: T;
  /** Accessible name, e.g. "Card view". */
  label: string;
  icon: LucideIcon;
}

/** View choice kept in `?view=`, so a preferred layout survives a refresh. */
export function useViewMode<T extends string>(options: readonly ViewOption<T>[], fallback: T) {
  const [params, setParams] = useSearchParams();
  const raw = params.get('view');
  const view = useMemo(
    () => (options.some((o) => o.value === raw) ? (raw as T) : fallback),
    [options, raw, fallback],
  );

  const setView = (next: T) => {
    const search = new URLSearchParams(params);
    if (next === fallback) search.delete('view');
    else search.set('view', next);
    setParams(search, { replace: true });
  };

  return { view, setView };
}

export function ViewToggle<T extends string>({
  options,
  value,
  onChange,
  label = 'Layout',
}: {
  options: readonly ViewOption<T>[];
  value: T;
  onChange: (next: T) => void;
  label?: string;
}) {
  function onKeyDown(e: React.KeyboardEvent, index: number) {
    const delta =
      e.key === 'ArrowRight' || e.key === 'ArrowDown'
        ? 1
        : e.key === 'ArrowLeft' || e.key === 'ArrowUp'
          ? -1
          : 0;
    if (!delta) return;
    e.preventDefault();
    onChange(options[(index + delta + options.length) % options.length].value);
  }

  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="flex shrink-0 items-center gap-1 rounded-xl bg-surface-2 p-1"
    >
      {options.map((option, i) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={option.label}
            tabIndex={selected ? 0 : -1}
            onKeyDown={(e) => onKeyDown(e, i)}
            onClick={() => onChange(option.value)}
            className={cn(
              'tap flex h-8 w-9 items-center justify-center rounded-lg',
              selected ? 'bg-brand text-white shadow-brand' : 'text-muted hover:text-ink',
            )}
          >
            <option.icon size={16} strokeWidth={2.25} aria-hidden />
          </button>
        );
      })}
    </div>
  );
}
