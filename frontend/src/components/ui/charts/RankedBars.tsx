import { DOMAIN_COLOR, type Domain } from './domain';
import { cn } from '@/lib/cn';

/**
 * A ranked horizontal bar list — the board's workhorse for "which ones are
 * worst / biggest": fullest hostel blocks, busiest mess halls, departments by
 * headcount, revenue by purpose.
 *
 * Horizontal rather than vertical because every row carries a name, and names
 * read at their natural length beside a bar instead of rotated under one. Bars
 * are laid out with plain divs, not SVG: a single-axis bar is a box with a
 * width, and CSS gives it text wrapping and tabular figures for free.
 *
 * Values are always direct-labelled, so identity and magnitude never depend on
 * colour alone.
 */

export interface RankedBarRow {
  key: string;
  label: string;
  value: number;
  /** Denominator for the bar's fill. Defaults to the largest value in the set. */
  max?: number;
  /** Right-hand text. Defaults to the value. Use for "412 / 500" or "₹1.2L". */
  display?: string;
  /** Overrides the domain hue — for status-coloured rows such as "over capacity". */
  color?: string;
}

export function RankedBars({
  rows,
  domain = 'hostels',
  label,
  emptyText = 'Nothing to show yet',
  className,
}: {
  rows: RankedBarRow[];
  domain?: Domain;
  /** Accessible name for the group, e.g. "Fullest hostel blocks". */
  label: string;
  emptyText?: string;
  className?: string;
}) {
  if (rows.length === 0) {
    return <p className="text-xs text-muted">{emptyText}</p>;
  }

  // A shared scale unless a row names its own, so bar lengths stay comparable
  // down the list. `|| 1` keeps an all-zero set from dividing by zero.
  const listMax = Math.max(...rows.map((r) => r.value), 0) || 1;

  return (
    <ul aria-label={label} className={cn('flex list-none flex-col gap-2 p-0', className)}>
      {rows.map((row) => {
        const max = row.max ?? listMax;
        const percent = max <= 0 ? 0 : Math.min(100, Math.max(0, (row.value / max) * 100));
        return (
          <li key={row.key} className="flex flex-col gap-1">
            <div className="flex items-baseline justify-between gap-3">
              <span className="min-w-0 truncate text-xs font-medium text-ink" title={row.label}>
                {row.label}
              </span>
              <span className="shrink-0 text-xs font-semibold tabular-nums text-muted">
                {row.display ?? row.value.toLocaleString()}
              </span>
            </div>
            <div
              role="progressbar"
              aria-label={row.label}
              aria-valuemin={0}
              aria-valuemax={max}
              aria-valuenow={row.value}
              aria-valuetext={row.display ?? `${row.value} of ${max}`}
              className="h-2 w-full overflow-hidden rounded-full bg-surface-2"
            >
              <div
                className="h-full rounded-full transition-[width] duration-500"
                style={{ width: `${percent}%`, background: row.color ?? DOMAIN_COLOR[domain] }}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
