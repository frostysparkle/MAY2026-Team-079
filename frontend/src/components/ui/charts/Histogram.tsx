import { DOMAIN_COLOR, type Domain } from './domain';
import { cn } from '@/lib/cn';

/**
 * A distribution across a small number of fixed buckets — staff workload
 * (0 / 1 / 2 / 3+ duties), how many domains a participant appears in.
 *
 * Vertical here, unlike `RankedBars`, because the buckets are an ordered scale
 * rather than a ranking: reading left-to-right along an axis is the point, and
 * reordering by size would destroy the meaning. Bucket labels are short by
 * construction, so they fit under a column without rotating.
 */

export interface HistogramBucket {
  key: string;
  label: string;
  value: number;
}

export function Histogram({
  buckets,
  domain = 'staff',
  label,
  height = 84,
  className,
}: {
  buckets: HistogramBucket[];
  domain?: Domain;
  /** Accessible name, e.g. "Staff by number of assigned duties". */
  label: string;
  height?: number;
  className?: string;
}) {
  if (buckets.length === 0) {
    return <p className="text-xs text-muted">Nothing to show yet</p>;
  }

  const max = Math.max(...buckets.map((b) => b.value), 0) || 1;

  return (
    <div
      role="img"
      aria-label={`${label}: ${buckets.map((b) => `${b.label} ${b.value}`).join(', ')}`}
      className={cn('flex items-end gap-[2px]', className)}
      style={{ height }}
    >
      {buckets.map((bucket) => {
        // A zero bucket still shows a 2px stub. Nothing at all reads as a
        // rendering gap; a visible floor reads as the real answer, "none".
        const percent = (bucket.value / max) * 100;
        return (
          <div key={bucket.key} className="flex h-full min-w-0 flex-1 flex-col justify-end gap-1">
            <span className="text-center text-[10px] font-semibold tabular-nums text-ink">
              {bucket.value.toLocaleString()}
            </span>
            <div
              className="w-full rounded-t-[4px] transition-[height] duration-500"
              style={{
                height: `max(2px, ${percent}%)`,
                background: bucket.value === 0 ? 'var(--color-line)' : DOMAIN_COLOR[domain],
              }}
            />
            <span className="truncate text-center text-[10px] text-muted" title={bucket.label}>
              {bucket.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}
