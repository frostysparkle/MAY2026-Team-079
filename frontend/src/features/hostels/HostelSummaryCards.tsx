import { BedDouble, Building2, CircleHelp, Mars, Venus } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { ProgressBar, Skeleton, StatCard, type StatTone } from '@/components/ui';
import {
  formatPercent,
  occupancyStatus,
  occupancyTone,
  OCCUPANCY_UNREADABLE,
} from '@/features/occupancy';
import { type HostelCategory, type HostelSummary } from './hostelOccupancy';

/**
 * The headline figures above the hostel list.
 *
 * Every number here answers "how much of the accommodation is actually in use",
 * because that is the only thing an organiser can act on. Three earlier cards did
 * not, and were removed or rewritten:
 *
 * - "Total Hostels: 22" restated the row count sitting directly underneath it.
 *   It now leads with how many of those blocks anyone is actually allocated to.
 * - "Total Beds: 6,600 / 6,600 still free" and "Overall Occupancy: 0% / 0 of
 *   6,600" were the same fact twice. They are now one card.
 * - The men's and women's cards showed each category's *share of total capacity*
 *   (73% / 27%) beside a progress bar, which reads as occupancy. Sixteen empty
 *   blocks appeared to be 73% full. They now show real occupancy within the
 *   category, and the bar tracks that.
 *
 * Occupancy needs the Super-Admin-only statistics endpoint, so every figure
 * derived from it degrades to an explicit "needs access" rather than to a zero
 * that would read as "nobody is allocated".
 */

const CATEGORY_STYLE: Record<HostelCategory, { icon: LucideIcon; tone: StatTone; label: string }> =
  {
    men: { icon: Mars, tone: 'info', label: "Men's Hostels" },
    women: { icon: Venus, tone: 'accent', label: "Women's Hostels" },
    other: { icon: CircleHelp, tone: 'brand', label: 'Unspecified Hostels' },
  };

export function HostelSummaryCards({ summary }: { summary: HostelSummary | null }) {
  if (!summary) {
    return (
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-busy="true">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-[104px] rounded-2xl" />
        ))}
      </div>
    );
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <StatCard
        icon={Building2}
        tone="brand"
        label="Hostels In Use"
        value={
          summary.occupied === null ? (
            '—'
          ) : (
            <>
              {summary.occupied}
              <span className="text-base font-bold text-muted"> / {summary.hostels}</span>
            </>
          )
        }
        footnote={
          summary.occupied === null
            ? OCCUPANCY_UNREADABLE
            : `${summary.hostels - summary.occupied} empty · ${summary.staffed} of ${summary.hostels} staffed`
        }
      />

      <StatCard
        icon={BedDouble}
        tone="warning"
        label="Bed Occupancy"
        value={formatPercent(summary.percent)}
        footnote={
          summary.allocated === null ? (
            OCCUPANCY_UNREADABLE
          ) : (
            <div className="flex flex-col gap-1.5">
              <span className="tabular-nums">
                {summary.allocated.toLocaleString()} of {summary.beds.toLocaleString()} beds ·{' '}
                {(summary.available ?? 0).toLocaleString()} free
              </span>
              <ProgressBar
                value={summary.allocated}
                max={summary.beds}
                tone={occupancyTone(occupancyStatus(summary.percent ?? 0))}
                label="Overall bed occupancy"
              />
            </div>
          )
        }
      />

      {summary.byCategory.map((entry) => {
        const style = CATEGORY_STYLE[entry.category];
        return (
          <StatCard
            key={entry.category}
            icon={style.icon}
            tone={style.tone}
            label={style.label}
            value={entry.hostels}
            footnote={
              entry.allocated === null ? (
                OCCUPANCY_UNREADABLE
              ) : (
                <div className="flex flex-col gap-1.5">
                  <span className="tabular-nums">
                    {entry.allocated.toLocaleString()} of {entry.beds.toLocaleString()} beds (
                    {formatPercent(entry.percent)})
                  </span>
                  <ProgressBar
                    value={entry.allocated}
                    max={entry.beds}
                    tone={occupancyTone(occupancyStatus(entry.percent ?? 0))}
                    label={`${entry.label} bed occupancy`}
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
