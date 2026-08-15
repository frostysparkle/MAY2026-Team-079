import { useId } from 'react';
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

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
