import { cn } from '@/lib/cn';

/**
 * The "this is streaming" mark: a dot with an expanding halo, a label, and
 * optionally a count.
 *
 * Two things make it honest rather than decorative. It takes `live` and stops
 * pulsing when false, so a board whose polling has stalled or whose tier failed
 * does not keep advertising itself as live; and the state is carried in the
 * *text* as well as the animation, because "is this updating?" must be
 * answerable without seeing motion — by a screen reader, in a screenshot, or by
 * an admin with reduced-motion switched on, where the halo does not animate at
 * all.
 */
export function LivePill({
  live = true,
  label = 'Live',
  count,
  tone = 'success',
  className,
}: {
  live?: boolean;
  label?: string;
  /** Right-hand detail, e.g. "3 running". */
  count?: string;
  tone?: 'success' | 'brand' | 'warning';
  className?: string;
}) {
  const dot = live
    ? { success: 'bg-success', brand: 'bg-brand', warning: 'bg-warning' }[tone]
    : 'bg-muted';

  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-2 rounded-full bg-surface/80 px-2.5 py-1 ring-1 ring-line',
        className,
      )}
    >
      <span className="relative flex h-1.5 w-1.5 shrink-0" aria-hidden>
        {live && (
          <span
            className={cn('animate-pulse-ring absolute inset-0 rounded-full', dot)}
            style={{ transformOrigin: 'center' }}
          />
        )}
        <span className={cn('relative h-1.5 w-1.5 rounded-full', dot)} />
      </span>
      <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-ink">
        {live ? label : 'Paused'}
      </span>
      {count && <span className="text-[10px] tabular-nums text-muted">{count}</span>}
    </span>
  );
}
