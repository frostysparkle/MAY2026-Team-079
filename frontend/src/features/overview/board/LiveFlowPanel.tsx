import { useMemo } from 'react';
import { Activity } from 'lucide-react';
import { ROUTES } from '@/config/routes';
import { cn } from '@/lib/cn';
import { activityPulse } from '../auditSeries';
import type { AuditFeeds, TierState } from '../useFestSnapshot';
import { BoardBlock, BoardPanel } from './BoardPanel';
import { LivePill } from './LivePill';
import { TrendChart } from './TrendChart';
import { STREAM_ORDER, campusStreams, streamToday } from './boardSeries';

/**
 * The board's hero: everything moving on campus over the last 24 hours, as three
 * streams on one axis.
 *
 * The three are chosen because together they are the fest's physical state —
 * people arriving, people leaving, people eating — and because all three come
 * from the audit trail, which means they share a clock and can honestly be drawn
 * against one another. Registrations are deliberately absent: they happen in the
 * weeks before the fest, so on a 24-hour axis they would be a flat line at zero
 * that makes the chart's ceiling meaningless. They live in the trend deck lower
 * down, which can show days.
 *
 * The panel is honest about the trail's limits. Each audit feed is fetched with a
 * `limit`, so a feed that came back exactly at it is a floor rather than a count,
 * and the legend says so per stream rather than in one footnote an admin has to
 * map back themselves.
 */
export function LiveFlowPanel({
  audit,
  tier,
  className,
}: {
  audit: AuditFeeds;
  tier: TierState;
  className?: string;
}) {
  const series = useMemo(() => campusStreams(audit, 24), [audit]);
  // The time-bounded feed — see `ActivityPanel`. A spike is a statement about
  // hours, so it cannot be computed from a fixed number of rows.
  const pulse = useMemo(() => activityPulse(audit.pulse), [audit.pulse]);

  const legend = useMemo(
    () =>
      STREAM_ORDER.map((stream, index) => {
        const points = series[index].points;
        return {
          key: stream,
          label: series[index].label,
          color: series[index].color,
          today: streamToday(audit, stream),
          lastHour: points[points.length - 1]?.value ?? 0,
        };
      }),
    [series, audit],
  );

  // The trail is fetched with a per-action `limit`; a feed that came back exactly
  // at it was almost certainly cut off, so its total is a floor.
  const truncated = new Set(audit.truncated);
  const flooredStream: Record<string, boolean> = {
    arrivals: truncated.has('hostel check-ins'),
    departures: truncated.has('hostel check-outs'),
    meals: truncated.has('meal scans'),
  };

  const streaming = tier.updatedAt !== null;

  return (
    <BoardPanel
      title="Live campus flow"
      subtitle="Check-ins, check-outs, and meal swipes over the last 24 hours"
      lead={
        <span
          aria-hidden
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-2xl bg-brand-light text-brand-700"
        >
          <Activity size={17} strokeWidth={2.25} />
        </span>
      }
      controls={
        <LivePill live={streaming} count={`${pulse.lastHour.toLocaleString()} actions this hour`} />
      }
      tier={tier}
      to={ROUTES.adminAuditLogs}
      toLabel="Open audit logs"
      fill
      // The card's height is fixed by its grid row from `xl`, so the body scrolls
      // rather than clipping if the legend wraps or the chart cannot compress. In
      // the ordinary case there is nothing to scroll: the chart block below takes
      // up the slack.
      bodyClassName="no-scrollbar overflow-y-auto"
      className={className}
    >
      {/* Per-stream totals, doubling as the chart's legend. Direct-labelled, so
          the chart survives being read in greyscale. */}
      <ul className="grid list-none grid-cols-3 gap-3 p-0">
        {legend.map((stream) => (
          <li key={stream.key} className="min-w-0 rounded-2xl bg-surface-2/60 p-3">
            <div className="flex items-center gap-1.5">
              <span
                aria-hidden
                className="block h-2.5 w-2.5 shrink-0 rounded-[3px]"
                style={{ background: stream.color }}
              />
              <span className="truncate text-[10px] font-semibold uppercase tracking-wider text-muted">
                {stream.label}
              </span>
            </div>
            <p className="mt-1 text-xl font-black leading-tight tabular-nums text-ink">
              {flooredStream[stream.key] && (
                <span className="mr-0.5 text-sm font-bold text-muted" title="Trail truncated">
                  ≥
                </span>
              )}
              {stream.today.toLocaleString()}
            </p>
            <p className="text-[11px] tabular-nums text-muted">
              today · {stream.lastHour.toLocaleString()} this hour
            </p>
          </li>
        ))}
      </ul>

      {/* `flex-1` without `min-h-0`, deliberately: the automatic minimum size of a
          block holding a 236px chart is 236px, so this grows into spare height but
          never squeezes the chart into an unreadable band. When the card is too
          short for all three blocks, the body scrolls instead. */}
      <div className="flex-1">
        <TrendChart
          series={series}
          label="Campus activity over the last 24 hours"
          height={236}
          emptyText="No scans recorded in the last 24 hours"
        />
      </div>

      {/*
        The one figure on this panel that is a judgement rather than a count.
        `activityPulse` compares the last hour against the median of the six
        before it — a median so that one busy hour in the baseline cannot mask a
        genuine spike, and never firing on a zero baseline, because at the start
        of a fest everything is infinitely above nothing.
      */}
      <BoardBlock title="Activity pulse" aside={`typical ${pulse.baseline.toLocaleString()}/hour`}>
        <div className="flex items-center gap-3">
          <div
            role="progressbar"
            aria-label="Actions this hour against the typical hourly rate"
            aria-valuemin={0}
            aria-valuemax={Math.max(pulse.baseline * 3, pulse.lastHour, 1)}
            aria-valuenow={pulse.lastHour}
            aria-valuetext={`${pulse.lastHour} this hour, typically ${pulse.baseline}`}
            className="relative h-2 flex-1 overflow-hidden rounded-full bg-surface-2"
          >
            <div
              className={cn(
                'h-full rounded-full transition-[width] duration-700',
                pulse.spiking ? 'bg-warning' : 'bg-brand',
              )}
              style={{
                width: `${Math.min(100, (pulse.lastHour / Math.max(pulse.baseline * 3, 1)) * 100)}%`,
              }}
            />
            {/* Where the typical rate sits, so the bar is readable as a ratio and
                not just as a length. */}
            {pulse.baseline > 0 && (
              <span
                aria-hidden
                className="absolute inset-y-0 w-0.5 bg-ink/35"
                style={{ left: `${100 / 3}%` }}
              />
            )}
          </div>
          <span
            className={cn(
              'shrink-0 text-xs font-semibold',
              pulse.spiking ? 'text-warning' : 'text-muted',
            )}
          >
            {pulse.baseline === 0
              ? 'No baseline yet'
              : pulse.spiking
                ? 'Spiking'
                : 'Within normal range'}
          </span>
        </div>
      </BoardBlock>
    </BoardPanel>
  );
}
