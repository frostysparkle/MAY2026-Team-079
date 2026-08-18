import { type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight } from 'lucide-react';
import { DOMAIN_COLOR, Skeleton, type Domain } from '@/components/ui';
import { cn } from '@/lib/cn';
import type { TierState } from './useFestSnapshot';
import { Staleness } from './board/Staleness';

/**
 * The shell every board panel sits in: a domain-coloured rail, a heading, the
 * content, and a footer that says how old the figures are and where to go to act
 * on them.
 *
 * The rail is the board's categorical encoding — see `charts/domain.ts`. It is
 * the *only* thing carrying domain colour at panel level, which is what lets the
 * six hues coexist without ever being compared as series inside one chart.
 *
 * The footer link is the panel's whole purpose after the figures: the board is
 * read-only, so every panel ends by handing off to the section that owns the
 * thing. Nothing here mutates fest data, by construction.
 */

export function OverviewPanel({
  domain,
  hue: hueOverride,
  title,
  subtitle,
  tier,
  to,
  toLabel,
  badge,
  children,
  className,
}: {
  domain: Domain;
  /**
   * Overrides the domain rail. Used by the two cross-cutting panels — Finance
   * and Live activity — which are not one of the six fest domains and must not
   * borrow another domain's identity colour to look like one.
   */
  hue?: string;
  title: string;
  subtitle?: string;
  /** Drives the skeleton and the "updated Ns ago" line. */
  tier: TierState;
  /** Where this panel hands off to. Omitted for panels with no owning screen. */
  to?: string;
  toLabel?: string;
  /** Rendered top-right — a chip, a status, a count. */
  badge?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const hue = hueOverride ?? DOMAIN_COLOR[domain];

  return (
    <section
      aria-label={title}
      className={cn('glass-panel flex flex-col gap-4 overflow-hidden rounded-3xl p-5', className)}
      style={{ borderLeft: `4px solid ${hue}` }}
    >
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-black uppercase tracking-[0.12em] text-ink">{title}</h2>
          {subtitle && <p className="mt-0.5 text-xs text-muted">{subtitle}</p>}
        </div>
        {badge}
      </header>

      {/* Skeletons only on the very first load. A refresh keeps the previous
          figures on screen — replacing live numbers with grey boxes every thirty
          seconds is how a monitoring board becomes unreadable. */}
      {tier.loading && tier.updatedAt === null ? (
        <div className="flex flex-col gap-3" aria-busy="true">
          <Skeleton className="h-16 rounded-xl" />
          <Skeleton className="h-24 rounded-xl" />
        </div>
      ) : (
        <div className="flex flex-1 flex-col gap-4">{children}</div>
      )}

      <footer className="flex items-center justify-between gap-3 border-t border-line/70 pt-3">
        <Staleness tier={tier} />
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
    </section>
  );
}

/**
 * A compact figure inside a panel — smaller than `StatCard`, because a panel
 * shows four of these plus a chart and the page shows eight panels. The board's
 * density is the point: a command centre that needs scrolling to compare two
 * domains has failed at its one job.
 */
export function Figure({
  label,
  value,
  note,
  tone = 'default',
}: {
  label: string;
  /** Pre-formatted. Pass "—" for anything that could not be read. */
  value: ReactNode;
  note?: ReactNode;
  tone?: 'default' | 'good' | 'warn' | 'bad' | 'muted';
}) {
  const toneClass = {
    default: 'text-ink',
    good: 'text-success',
    warn: 'text-warning',
    bad: 'text-danger',
    muted: 'text-muted',
  }[tone];

  return (
    <div className="min-w-0">
      <p className="truncate text-[10px] font-semibold uppercase tracking-wider text-muted">
        {label}
      </p>
      <p className={cn('text-xl font-black leading-tight tabular-nums', toneClass)}>{value}</p>
      {note && <p className="mt-0.5 truncate text-[11px] text-muted">{note}</p>}
    </div>
  );
}

/** The 2–4 column grid a panel's figures sit in. */
export function FigureRow({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">{children}</div>;
}

/** A labelled block inside a panel, above a chart. */
export function PanelBlock({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted">{title}</h3>
      {children}
    </div>
  );
}
