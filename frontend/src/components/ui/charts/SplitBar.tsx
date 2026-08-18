import { cn } from '@/lib/cn';

/**
 * A single bar divided into named parts — inside vs out, open vs closed,
 * assigned vs unassigned, paid vs pending vs refunded.
 *
 * Segments are separated by a 2px gap in the surface colour rather than butted
 * together, so two adjacent fills read as two quantities instead of one blurred
 * band. Every segment is direct-labelled beneath the bar, which is what lets the
 * chart survive being read in greyscale.
 *
 * Zero-value segments are dropped from the bar but kept in the legend: "0
 * refunded" is information, a 0px-wide slice is a rendering artefact.
 */

export interface SplitSegment {
  key: string;
  label: string;
  value: number;
  color: string;
}

export function SplitBar({
  segments,
  label,
  className,
  showLegend = true,
}: {
  segments: SplitSegment[];
  /** Accessible name, e.g. "Participants inside versus outside". */
  label: string;
  className?: string;
  showLegend?: boolean;
}) {
  const total = segments.reduce((sum, s) => sum + Math.max(0, s.value), 0);
  const visible = segments.filter((s) => s.value > 0);

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <div
        role="img"
        aria-label={`${label}: ${segments.map((s) => `${s.label} ${s.value}`).join(', ')}`}
        className="flex h-2.5 w-full gap-[2px] overflow-hidden rounded-full bg-surface-2"
      >
        {total === 0
          ? null
          : visible.map((segment) => (
              <div
                key={segment.key}
                className="h-full rounded-full transition-[flex-grow] duration-500"
                style={{ flexGrow: segment.value, background: segment.color }}
              />
            ))}
      </div>

      {showLegend && (
        <ul className="flex list-none flex-wrap gap-x-4 gap-y-1 p-0">
          {segments.map((segment) => (
            <li key={segment.key} className="flex items-center gap-1.5">
              <span
                aria-hidden
                className="block h-2.5 w-2.5 shrink-0 rounded-[3px]"
                style={{ background: segment.color }}
              />
              <span className="text-xs text-muted">
                {segment.label}{' '}
                <b className="font-semibold tabular-nums text-ink">
                  {segment.value.toLocaleString()}
                </b>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
