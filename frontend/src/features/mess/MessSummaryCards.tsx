import { Armchair, Building2, Leaf, Drumstick, Sprout, UtensilsCrossed } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { ProgressBar, Skeleton, StatCard, type StatTone } from '@/components/ui';
import { formatShare, OCCUPANCY_UNREADABLE } from '@/features/occupancy';
import type { MessSummary, MessType } from './messOccupancy';

/**
 * The headline figures above the mess list: how many halls, how many seats, how
 * many of those seats are taken, and how they split across the dietary
 * designations.
 *
 * One card per designation actually present, rather than a fixed pair of veg and
 * non-veg cards. The campus has jain halls too, and a summary that showed only
 * two of the three would silently omit a slice of the seats it is claiming to
 * account for — the shares would not add up to 100%.
 *
 * Every figure, including the supporting line under each one, is derived from the
 * inventory. Occupancy is the only one that can be unavailable — it needs the
 * Super-Admin-only statistics endpoint — and says so rather than reading as zero.
 */

const TYPE_STYLE: Record<MessType, { icon: LucideIcon; tone: StatTone }> = {
  veg: { icon: Leaf, tone: 'success' },
  non_veg: { icon: Drumstick, tone: 'warning' },
  jain: { icon: Sprout, tone: 'brand' },
  other: { icon: UtensilsCrossed, tone: 'info' },
};

const BAR_TONE: Record<MessType, 'brand' | 'success' | 'warning' | 'danger'> = {
  veg: 'success',
  non_veg: 'warning',
  jain: 'brand',
  other: 'brand',
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
        label="Total Halls"
        value={summary.halls}
        // Staffing, not a restatement of the count. It used to read "Active mess
        // halls", which claimed a distinction the data does not carry: a hall has
        // no active flag. What it does carry is whether anyone can scan for it.
        footnote={
          summary.halls === 0
            ? 'None added yet'
            : summary.staffed === summary.halls
              ? 'Every hall has a team'
              : `${summary.staffed} of ${summary.halls} with a team`
        }
      />
      <StatCard
        icon={Armchair}
        tone="info"
        label="Total Seats"
        value={summary.seats.toLocaleString()}
        // The summary already computes occupancy from the per-hall statistics;
        // this is where it becomes visible rather than being thrown away.
        footnote={
          summary.allocated === null || summary.available === null ? (
            OCCUPANCY_UNREADABLE
          ) : (
            <div className="flex flex-col gap-1.5">
              <span className="tabular-nums">
                {summary.allocated.toLocaleString()} allocated ({formatShare(summary.percent)}) ·{' '}
                {summary.available.toLocaleString()} free
              </span>
              <ProgressBar
                value={summary.allocated}
                max={summary.seats}
                tone="brand"
                label="Overall seats allocated"
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
            value={
              <>
                {entry.seats.toLocaleString()}{' '}
                <span className="text-base font-bold text-muted">({formatShare(entry.share)})</span>
              </>
            }
            footnote={
              <div className="flex flex-col gap-1.5">
                <span>
                  Offered by {entry.halls} hall{entry.halls === 1 ? '' : 's'}
                </span>
                <ProgressBar
                  value={entry.seats}
                  max={summary.seats}
                  tone={BAR_TONE[entry.type]}
                  label={`${entry.label} share of every seat`}
                />
              </div>
            }
          />
        );
      })}
    </div>
  );
}
