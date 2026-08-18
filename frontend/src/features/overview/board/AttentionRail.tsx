import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowUpRight,
  CheckCircle2,
  ChevronRight,
  Info,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react';
import { StatusBadge } from '@/components/ui';
import { cn } from '@/lib/cn';
import { SEVERITY_LABEL, SEVERITY_TONE, type AlertSeverity, type FestAlert } from '../festAlerts';
import { BoardPanel } from './BoardPanel';
import { LivePill } from './LivePill';
import type { TierState } from '../useFestSnapshot';

/**
 * "Attention needed": everything on fire, severity-sorted, then the specific
 * places that are close to it.
 *
 * Two properties are load-bearing. **"All clear" is a real row**, not an empty
 * list — an empty strip reads equally as "no problems" and as "the strip is
 * broken", and an admin scanning a monitoring board needs the difference stated.
 * And **severity never depends on hue alone**: every alert carries an icon and
 * the word for its level alongside the colour.
 *
 * The rail scrolls inside its own panel rather than growing the page, so the
 * hero row keeps its height whether there are no alerts or fifteen. That is the
 * one place on this board where clipping content is right: the alerts are sorted
 * worst-first, so what gets pushed below the fold is always the least urgent
 * thing.
 */

const SEVERITY_ICON: Record<AlertSeverity, LucideIcon> = {
  critical: TriangleAlert,
  warning: AlertTriangle,
  attention: Info,
  info: Info,
};

const SEVERITY_SURFACE: Record<AlertSeverity, string> = {
  critical: 'bg-danger-bg/60 ring-danger/25',
  warning: 'bg-warning-bg/60 ring-warning/25',
  attention: 'bg-info-bg/50 ring-info/25',
  info: 'bg-surface-2/80 ring-line',
};

const SEVERITY_ICON_COLOR: Record<AlertSeverity, string> = {
  critical: 'text-danger',
  warning: 'text-warning',
  attention: 'text-info',
  info: 'text-muted',
};

/** A named place that is close to, or over, its capacity. */
export interface PressurePoint {
  id: string;
  name: string;
  /** "Hostel" or "Mess" — which inventory this belongs to. */
  kind: string;
  /** Pre-formatted, e.g. "94% full" or "over capacity". */
  status: string;
  critical: boolean;
  to: string;
}

export function AttentionRail({
  alerts,
  pressure,
  tier,
  loading,
  className,
}: {
  alerts: FestAlert[];
  /** Blocks and halls under capacity pressure, worst first. */
  pressure: PressurePoint[];
  tier: TierState;
  /** True while any tier is in flight — distinguishes "all clear" from "not yet". */
  loading: boolean;
  className?: string;
}) {
  const criticals = alerts.filter((alert) => alert.severity === 'critical').length;

  return (
    <BoardPanel
      // The name the board's tests and a screen-reader user both reach it by.
      title="Fest health"
      subtitle={
        alerts.length === 0
          ? 'Nothing needs attention'
          : `${alerts.length} ${alerts.length === 1 ? 'item needs' : 'items need'} attention`
      }
      lead={
        <span
          aria-hidden
          className={cn(
            'flex h-8 w-8 shrink-0 items-center justify-center rounded-2xl',
            criticals > 0 ? 'bg-danger-bg text-danger' : 'bg-success-bg text-success',
          )}
        >
          {criticals > 0 ? (
            <TriangleAlert size={17} strokeWidth={2.25} />
          ) : (
            <CheckCircle2 size={17} strokeWidth={2.25} />
          )}
        </span>
      }
      controls={
        criticals > 0 ? (
          <StatusBadge tone="danger">
            {criticals} critical {criticals === 1 ? 'issue' : 'issues'}
          </StatusBadge>
        ) : (
          <LivePill live={!loading} label="Watching" />
        )
      }
      tier={tier}
      fill
      className={className}
      bodyClassName="min-h-0"
    >
      {/*
        A polite live region: an alert that appears while the admin is reading
        another panel is exactly the one they must not miss. `polite` rather than
        `assertive` so it waits for a pause instead of interrupting.
      */}
      <div
        aria-live="polite"
        className="no-scrollbar -mr-2 flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pr-2"
      >
        {alerts.length === 0 ? (
          <div className="flex items-start gap-3 rounded-2xl bg-success-bg/50 p-4 ring-1 ring-success/20">
            <CheckCircle2 size={19} strokeWidth={2.25} className="mt-0.5 shrink-0 text-success" />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-ink">
                {loading ? 'Checking every section…' : 'All clear'}
              </p>
              <p className="mt-0.5 text-xs leading-relaxed text-muted">
                {loading
                  ? 'Figures are still arriving.'
                  : 'No capacity, staffing, or attendance issues detected.'}
              </p>
            </div>
          </div>
        ) : (
          <ul className="flex list-none flex-col gap-2 p-0">
            {alerts.map((alert) => {
              const Icon = SEVERITY_ICON[alert.severity];
              return (
                <li
                  key={alert.id}
                  className={cn(
                    'flex flex-col gap-2 rounded-2xl p-3.5 ring-1',
                    SEVERITY_SURFACE[alert.severity],
                  )}
                >
                  <div className="flex items-start gap-2.5">
                    <Icon
                      size={17}
                      strokeWidth={2.25}
                      className={cn('mt-0.5 shrink-0', SEVERITY_ICON_COLOR[alert.severity])}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <p className="text-sm font-semibold leading-snug text-ink">{alert.title}</p>
                        <StatusBadge tone={SEVERITY_TONE[alert.severity]}>
                          {SEVERITY_LABEL[alert.severity]}
                        </StatusBadge>
                      </div>
                      <p className="mt-1 text-xs leading-relaxed text-muted">{alert.detail}</p>
                    </div>
                  </div>
                  {alert.action && (
                    <Link
                      to={alert.action.to}
                      className="tap ml-7 inline-flex w-fit items-center gap-1 rounded-full bg-surface px-3 py-1.5 text-xs font-semibold text-ink shadow-card ring-1 ring-line hover:bg-surface-2"
                    >
                      {alert.action.label}
                      <ArrowUpRight size={13} strokeWidth={2.5} />
                    </Link>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {/* The named places behind the capacity alerts above. The alert says how
            many are under pressure; this says which, and goes straight there. */}
        {pressure.length > 0 && (
          <div className="mt-2 border-t border-line/70 pt-3">
            <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted">
              Places under pressure
            </h3>
            <ul className="flex list-none flex-col gap-1 p-0">
              {pressure.map((place) => (
                <li key={`${place.kind}-${place.id}`}>
                  <Link
                    to={place.to}
                    className="tap group flex items-center gap-3 rounded-xl px-2 py-2 hover:bg-surface-2"
                  >
                    <span
                      aria-hidden
                      className={cn(
                        'flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-[10px] font-bold uppercase',
                        place.critical ? 'bg-danger-bg text-danger' : 'bg-warning-bg text-warning',
                      )}
                    >
                      {place.kind.slice(0, 1)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-ink group-hover:text-brand">
                        {place.name}
                      </span>
                      <span
                        className={cn(
                          'block text-[11px]',
                          place.critical ? 'text-danger' : 'text-warning',
                        )}
                      >
                        {place.kind} · {place.status}
                      </span>
                    </span>
                    <ChevronRight size={16} className="shrink-0 text-muted" aria-hidden />
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </BoardPanel>
  );
}
