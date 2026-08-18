import { BarChart3, BedDouble, Building2, CircleHelp, Mars, Venus } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { ProgressBar, Skeleton, StatCard, type StatTone } from '@/components/ui';
import { formatPercent, formatShare, OCCUPANCY_UNREADABLE } from '@/features/occupancy';
import { type HostelCategory, type HostelSummary } from './hostelOccupancy';

/**
 * The headline figures above the hostel list: how many blocks, how many beds, how
 * those beds split by category, and how much of the campus is actually taken.
 *
 * One card per category actually present, rather than a fixed men's/women's pair.
 * A block whose gender field is outside the two known values is filed as
 * "Unspecified", and a summary that showed only two of the three would silently
 * omit a slice of the beds it is claiming to account for — the shares would not
 * add up to 100%. Same reasoning as the mess dietary designations.
 *
 * Every figure here is derived from the inventory. Occupancy is the only one that
 * can be unavailable — it needs the Super-Admin-only statistics endpoint — so it
 * degrades to an explicit dash rather than to a zero that would read as "nobody
 * has been allocated".
 */

const CATEGORY_STYLE: Record<HostelCategory, { icon: LucideIcon; tone: StatTone; label: string }> =
  {
    men: { icon: Mars, tone: 'success', label: "Men's Hostels" },
    women: { icon: Venus, tone: 'accent', label: "Women's Hostels" },
    other: { icon: CircleHelp, tone: 'info', label: 'Unspecified Hostels' },
  };

const BAR_TONE: Record<HostelCategory, 'brand' | 'success' | 'warning' | 'danger'> = {
  men: 'success',
  women: 'danger',
  other: 'brand',
};

export function HostelSummaryCards({ summary }: { summary: HostelSummary | null }) {
  if (!summary) {
    return (
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5" aria-busy="true">
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} className="h-[104px] rounded-2xl" />
        ))}
      </div>
    );
  }

  const occupancyKnown = summary.percent !== null;

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
      <StatCard
        icon={Building2}
        tone="brand"
        label="Total Hostels"
        value={summary.hostels}
        // Staffing, not a restatement of the count: a block with no team is one
        // nobody can scan entry or exit for, which is worth seeing up front.
        footnote={
          summary.hostels === 0
            ? 'None added yet'
            : summary.staffed === summary.hostels
              ? 'Every block has a team'
              : `${summary.staffed} of ${summary.hostels} with a team`
        }
      />
      <StatCard
        icon={BedDouble}
        tone="info"
        label="Total Beds"
        value={summary.beds.toLocaleString()}
        footnote={
          summary.available === null
            ? OCCUPANCY_UNREADABLE
            : `${summary.available.toLocaleString()} still free`
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
              <div className="flex flex-col gap-1.5">
                <span className="tabular-nums">
                  {entry.beds.toLocaleString()} beds ({formatShare(entry.share)})
                </span>
                <ProgressBar
                  value={entry.beds}
                  max={summary.beds}
                  tone={BAR_TONE[entry.category]}
                  label={`${entry.label} share of every bed`}
                />
              </div>
            }
          />
        );
      })}

      <StatCard
        icon={BarChart3}
        tone="warning"
        label="Overall Occupancy"
        value={formatPercent(summary.percent)}
        footnote={
          occupancyKnown ? (
            <div className="flex flex-col gap-1.5">
              <span className="tabular-nums">
                {summary.allocated?.toLocaleString()} / {summary.beds.toLocaleString()} beds
              </span>
              <ProgressBar
                value={summary.allocated ?? 0}
                max={summary.beds}
                tone="warning"
                label="Overall campus occupancy"
              />
            </div>
          ) : (
            OCCUPANCY_UNREADABLE
          )
        }
      />
    </div>
  );
}
