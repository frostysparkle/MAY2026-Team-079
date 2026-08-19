import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight } from 'lucide-react';
import { Skeleton } from '@/components/ui';
import { cn } from '@/lib/cn';
import { Staleness } from './Staleness';
import type { TierState } from '../useFestSnapshot';

/**
 * The control board's panel: a glass surface, a heading row that can carry a
 * live indicator and its own controls, the content, and a footer stating how old
 * the figures are and where to go to act on them.
 *
 * This is the board-level counterpart to `OverviewPanel`, which the eight domain
 * panels lower down the page still use. The two are deliberately different
 * shapes rather than one configurable component: a domain panel is a fixed
 * report identified by a coloured rail, while a board panel is a workspace that
 * hosts tabs, a scrolling rail, or a drill-in, and sizes itself to a grid cell.
 * Folding them together would mean a component with two disjoint halves.
 *
 * Read-only, like everything else on the board. `to` is the hand-off: the panel
 * shows the figures and then names the section that owns them.
 */
export function BoardPanel({
  title,
  subtitle,
  /** Rendered right of the title — tabs, a period select, a toggle. */
  controls,
  /** Small mark left of the title. Use `LivePill` for anything streaming. */
  lead,
  tier,
  to,
  toLabel,
  /** Replaces the staleness line in the footer. Pass `null` for no footer. */
  footer,
  /** Fills the panel to its grid row height and scrolls the body instead. */
  fill = false,
  bodyClassName,
  className,
  children,
}: {
  title: string;
  subtitle?: ReactNode;
  controls?: ReactNode;
  lead?: ReactNode;
  /** Drives the first-load skeleton and the "updated Ns ago" line. */
  tier: TierState;
  to?: string;
  toLabel?: string;
  footer?: ReactNode | null;
  fill?: boolean;
  bodyClassName?: string;
  className?: string;
  children: ReactNode;
}) {
  // `aria-label` rather than a heading-only name, so the eight domain panels and
  // these board panels are all reachable the same way: by region name.
  return (
    <section
      aria-label={title}
      className={cn(
        'glass-panel flex flex-col gap-4 rounded-3xl p-5',
        fill && 'h-full min-h-0',
        className,
      )}
    >
      <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="flex min-w-0 items-center gap-2.5">
          {lead}
          <div className="min-w-0">
            <h2 className="truncate text-sm font-black uppercase tracking-[0.14em] text-ink">
              {title}
            </h2>
            {subtitle && <p className="mt-0.5 text-xs text-muted">{subtitle}</p>}
          </div>
        </div>
        {controls && <div className="flex shrink-0 items-center gap-1.5">{controls}</div>}
      </header>

      {/* Skeletons only on the very first load. A refresh keeps the previous
          figures on screen — swapping live numbers for grey boxes every thirty
          seconds is how a monitoring board becomes unreadable. */}
      {tier.loading && tier.updatedAt === null ? (
        <div className="flex flex-col gap-3" aria-busy="true">
          <Skeleton className="h-16 rounded-2xl" />
          <Skeleton className="h-28 rounded-2xl" />
        </div>
      ) : (
        <div
          className={cn('flex flex-col gap-4', fill ? 'min-h-0 flex-1' : 'flex-1', bodyClassName)}
        >
          {children}
        </div>
      )}

      {footer !== null && (
        <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-line/70 pt-3">
          {footer ?? <Staleness tier={tier} />}
          {to && (
            <Link
              to={to}
              className="tap inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-1 text-xs font-semibold text-brand hover:bg-brand-light"
            >
              {toLabel ?? 'Open'}
              <ArrowUpRight size={13} strokeWidth={2.5} />
            </Link>
          )}
        </footer>
      )}
    </section>
  );
}

/**
 * A block inside a board panel: a small caps heading over its content.
 * Same vocabulary as `PanelBlock` in the domain panels, so the two halves of the
 * page label their internals identically.
 */
export function BoardBlock({
  title,
  aside,
  children,
  className,
}: {
  title: string;
  /** Right-aligned detail on the heading line, e.g. a total. */
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted">{title}</h3>
        {aside && <span className="text-[11px] tabular-nums text-muted">{aside}</span>}
      </div>
      {children}
    </div>
  );
}
