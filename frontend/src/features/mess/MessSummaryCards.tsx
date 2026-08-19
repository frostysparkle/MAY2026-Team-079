import { Building2, Drumstick, Leaf, Sprout, UtensilsCrossed } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { ProgressBar, Skeleton, StatCard, type StatTone } from '@/components/ui';
import {
  formatPercent,
  occupancyStatus,
  occupancyTone,
  OCCUPANCY_UNREADABLE,
} from '@/features/occupancy';
import type { MessSummary, MessType } from './messOccupancy';

/**
 * The headline figures above the mess list.
 *
 * Every number answers "how much of the catering is actually in use". Two of
 * these used to answer something else, and were rewritten for the same reasons
 * the hostel cards were:
 *
 * - "Total Halls: 3" restated the row count in the table directly below it. It
 *   now leads with how many halls anyone is actually allocated to.
 * - The veg / non-veg / jain cards showed each designation's *share of total
 *   capacity* (38% / 38% / 25%) beside a progress bar, which reads as occupancy —
 *   an entirely empty 450-seat hall appeared to be 38% full. They now show real
 *   occupancy within the designation, and the bar tracks that.
 *
 * One card per designation actually present, rather than a fixed veg/non-veg
 * pair: the campus has jain halls too, and omitting one would drop a slice of the
 * seats this summary claims to account for.
 *
 * Occupancy needs the Super-Admin-only statistics endpoint, so anything derived
 * from it degrades to an explicit "needs access" rather than to a zero that would
 * read as "nobody is allocated".
 */

const TYPE_STYLE: Record<MessType, { icon: LucideIcon; tone: StatTone }> = {
  veg: { icon: Leaf, tone: 'success' },
  non_veg: { icon: Drumstick, tone: 'warning' },
  jain: { icon: Sprout, tone: 'brand' },
  other: { icon: UtensilsCrossed, tone: 'info' },
};

export function MessSummaryCards({ summary }: { summary: MessSummary | null }) {
  if (!summary) {
    return (
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5" aria-busy="true">
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} className="h-[104px] rounded-2xl" />
        ))}
      </div>
    );
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
      <StatCard
        icon={Building2}
        tone="brand"
        label="Mess Halls In Use"
        value={
          summary.occupied === null ? (
            '—'
          ) : (
            <>
              {summary.occupied}
              <span className="text-base font-bold text-muted"> / {summary.halls}</span>
            </>
          )
        }
        footnote={
          summary.occupied === null
            ? OCCUPANCY_UNREADABLE
            : `${summary.halls - summary.occupied} empty · ${summary.staffed} of ${summary.halls} staffed`
        }
      />

      <StatCard
        icon={UtensilsCrossed}
        tone="info"
        label="Seat Occupancy"
        value={formatPercent(summary.percent)}
        footnote={
          summary.allocated === null ? (
            OCCUPANCY_UNREADABLE
          ) : (
            <div className="flex flex-col gap-1.5">
              <span className="tabular-nums">
                {summary.allocated.toLocaleString()} of {summary.seats.toLocaleString()} seats ·{' '}
                {(summary.available ?? 0).toLocaleString()} free
              </span>
              <ProgressBar
                value={summary.allocated}
                max={summary.seats}
                tone={occupancyTone(occupancyStatus(summary.percent ?? 0))}
                label="Overall seat occupancy"
              />
            </div>
          )
        }
      />

      {summary.byType.map((entry) => {
        const style = TYPE_STYLE[entry.type];
        return (
          <StatCard
            key={entry.type}
            icon={style.icon}
            tone={style.tone}
            label={`${entry.label} Seats`}
            value={entry.seats.toLocaleString()}
            footnote={
              entry.allocated === null ? (
                OCCUPANCY_UNREADABLE
              ) : (
                <div className="flex flex-col gap-1.5">
                  <span className="tabular-nums">
                    {entry.allocated.toLocaleString()} allocated ({formatPercent(entry.percent)}) ·{' '}
                    {entry.halls} hall{entry.halls === 1 ? '' : 's'}
                  </span>
                  <ProgressBar
                    value={entry.allocated}
                    max={entry.seats}
                    tone={occupancyTone(occupancyStatus(entry.percent ?? 0))}
                    label={`${entry.label} seat occupancy`}
                  />
                </div>
              )
            }
          />
        );
      })}
    </div>
  );
}
