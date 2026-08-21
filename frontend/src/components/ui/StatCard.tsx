import { useId } from 'react';
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { Skeleton } from './Skeleton';

/**
 * A single headline figure with its label, icon, and one line of supporting
 * detail — the summary row that sits above an admin list.
 *
 * The tone tints the whole card (surface wash, ring, and icon tile) rather than
 * just the icon, so a row of these reads as a set of distinct measures at a
 * glance instead of five identical white boxes.
 */

export type StatTone = 'brand' | 'info' | 'success' | 'accent' | 'warning';

const toneClasses: Record<StatTone, { card: string; tile: string }> = {
  brand: { card: 'bg-brand-50 ring-brand/15', tile: 'bg-brand-100 text-brand-700' },
  info: { card: 'bg-info-bg/45 ring-info/15', tile: 'bg-info-bg text-info' },
  success: { card: 'bg-success-bg/45 ring-success/15', tile: 'bg-success-bg text-success' },
  accent: { card: 'bg-accent/[0.06] ring-accent/15', tile: 'bg-accent/10 text-accent' },
  warning: { card: 'bg-warning-bg/45 ring-warning/15', tile: 'bg-warning-bg text-warning' },
};

export function StatCard({
  icon: Icon,
  label,
  value,
  tone = 'brand',
  footnote,
  className,
}: {
  icon: LucideIcon;
  label: string;
  /** The headline figure. Pre-formatted, e.g. "6600" or "28.4%". */
  value: ReactNode;
  tone?: StatTone;
  /** Supporting line under the figure: a caption, a badge, or a progress bar. */
  footnote?: ReactNode;
  className?: string;
}) {
  const tint = toneClasses[tone];
  const labelId = useId();

  return (
    // A named group, so a row of these is navigable card by card rather than as a
    // run of loose text: assistive tech reads "Total Beds, 6600, Overall capacity"
    // as one unit. `role="group"` rather than a <section>, which would map to a
    // landmark and put five of them in the landmark list.
    <div
      role="group"
      aria-labelledby={labelId}
      className={cn('flex flex-col gap-2 rounded-2xl p-4 shadow-card ring-1', tint.card, className)}
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className={cn(
            'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl',
            tint.tile,
          )}
        >
          <Icon size={19} strokeWidth={2} />
        </span>
        <div className="min-w-0 flex-1">
          <p id={labelId} className="text-xs font-semibold uppercase tracking-wide text-muted">
            {label}
          </p>
          <p className="mt-0.5 text-2xl font-black leading-tight tabular-nums text-ink">{value}</p>
        </div>
      </div>
      {/* Reserved height keeps the cards aligned even when only some of them have
          a footnote to show. */}
      {footnote !== undefined && <div className="min-h-5 text-xs text-muted">{footnote}</div>}
    </div>
  );
}

/**
 * The responsive grid a row of `StatCard`s sits on — the counterpart of
 * `EVENT_GRID_CLASS`, and for the same reason: a screen that re-types the grid
 * is a screen that can pick a different one.
 *
 * Three of them had. The participant dashboard and the schedule went one-up on a
 * phone and two-up from `sm`, while Help & Support went two-up on a phone and
 * *four*-up from `sm` — which at that width leaves each card about 175px to fit a
 * 40px icon tile, an uppercase label and a 2xl figure, so its labels wrapped
 * where the other two screens' did not. One-up then two-up then four-up is the
 * majority and the readable one, so it is the only one now.
 */
export const STAT_GRID_CLASS = 'grid gap-3 sm:grid-cols-2 xl:grid-cols-4';

/** Matches a loaded `StatCard`'s height, so the row does not resize on arrival. */
const STAT_SKELETON_CLASS = 'h-[104px] rounded-2xl';

/**
 * A row of headline figures, with its own loading state.
 *
 * Owning the skeleton is the point: every screen that had a stat row also had a
 * hand-copied `Array.from` of skeletons beside it, which is two places per screen
 * for the grid to drift and one more for the placeholder height to.
 */
export function StatGrid({
  loading = false,
  count = 4,
  className,
  children,
}: {
  /** Renders `count` placeholders instead of `children`. */
  loading?: boolean;
  /** How many placeholders the loading state shows. */
  count?: number;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <div className={cn(STAT_GRID_CLASS, className)} aria-busy={loading || undefined}>
      {loading
        ? Array.from({ length: count }, (_, i) => (
            <Skeleton key={i} className={STAT_SKELETON_CLASS} />
          ))
        : children}
    </div>
  );
}
