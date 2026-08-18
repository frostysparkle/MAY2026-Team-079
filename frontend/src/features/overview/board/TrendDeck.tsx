import { useMemo, useState } from 'react';
import { LineChart } from 'lucide-react';
import { ROUTES } from '@/config/routes';
import { cn } from '@/lib/cn';
import type { AuditFeeds, TierState } from '../useFestSnapshot';
import { BoardPanel } from './BoardPanel';
import { TrendChart } from './TrendChart';
import { DECK_LABEL, DECK_ORDER, deckIsFloored, deckSeries, type DeckKey } from './boardSeries';
import { windowDelta } from './trendScale';

/**
 * The deck at the foot of the board: one series at a time, at full width, over
 * either the last 24 hours or the whole fest so far.
 *
 * The hero panel above draws three streams together, which is the right shape for
 * "is anything happening right now" and the wrong one for "how has this one
 * moved" — three lines sharing a ceiling means the smallest of them lies flat
 * against the axis. So the deck trades breadth for resolution: a single series
 * gets its own scale, a filled area, and the full width of the page.
 *
 * The "By day" view is what makes event sign-ups legible at all, since most of
 * them happen in the weeks before the fest and are invisible on a 24-hour axis.
 */

const RANGES = { hours: 'Last 24 hours', days: 'By day' } as const;
type RangeKey = keyof typeof RANGES;

export function TrendDeck({
  audit,
  tier,
  className,
}: {
  audit: AuditFeeds;
  tier: TierState;
  className?: string;
}) {
  const [stream, setStream] = useState<DeckKey>('meals');
  const [range, setRange] = useState<RangeKey>('hours');

  const series = useMemo(() => deckSeries(audit, stream, range), [audit, stream, range]);

  // "This hour against last" on the hourly view, "today against yesterday" on
  // the daily one — the comparison the range selector implies, rather than one
  // fixed window that would quietly mean something different in each view.
  const delta = useMemo(() => windowDelta(series.points, 1), [series.points]);
  const total = series.points.reduce((sum, point) => sum + point.value, 0);
  const peak = Math.max(0, ...series.points.map((point) => point.value));
  const floored = deckIsFloored(audit, stream);

  return (
    <BoardPanel
      title="Trends"
      subtitle={`${DECK_LABEL[stream]} · ${RANGES[range].toLowerCase()}`}
      lead={
        <span
          aria-hidden
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-2xl bg-brand-light text-brand-700"
        >
          <LineChart size={17} strokeWidth={2.25} />
        </span>
      }
      controls={
        <label className="flex items-center gap-2">
          <span className="sr-only">Time range</span>
          <select
            value={range}
            onChange={(event) => setRange(event.target.value as RangeKey)}
            className="tap cursor-pointer rounded-full bg-surface-2 px-3 py-1.5 text-xs font-semibold text-ink hover:bg-surface"
          >
            {(Object.keys(RANGES) as RangeKey[]).map((key) => (
              <option key={key} value={key}>
                {RANGES[key]}
              </option>
            ))}
          </select>
        </label>
      }
      tier={tier}
      to={ROUTES.adminAuditLogs}
      toLabel="Open audit logs"
      footer={
        <p className="text-[11px] text-muted">
          {floored
            ? 'This feed came back at its fetch limit, so the oldest buckets understate the real figures.'
            : 'Every figure is read from the audit trail.'}
        </p>
      }
      className={className}
    >
      {/*
        A tablist rather than a plain row of buttons, so a screen reader announces
        "tab 2 of 4, selected" and arrow keys move between them — the behaviour the
        visual design already implies.
      */}
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2 border-b border-line">
        <div
          role="tablist"
          aria-label="Which series to plot"
          className="no-scrollbar -mb-px flex gap-1 overflow-x-auto"
        >
          {DECK_ORDER.map((key) => {
            const selected = stream === key;
            return (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => setStream(key)}
                className={cn(
                  'tap whitespace-nowrap border-b-2 px-3 py-2 text-xs font-bold transition-colors sm:text-sm',
                  selected
                    ? 'border-brand text-brand-700'
                    : 'border-transparent text-muted hover:text-ink',
                )}
              >
                {DECK_LABEL[key]}
              </button>
            );
          })}
        </div>

        <dl className="flex gap-5 pb-2">
          <div>
            <dt className="text-[10px] font-semibold uppercase tracking-wider text-muted">Total</dt>
            <dd className="text-lg font-black leading-tight tabular-nums text-ink">
              {floored && (
                <span className="mr-0.5 text-sm text-muted" title="Trail truncated — a floor">
                  ≥
                </span>
              )}
              {total.toLocaleString()}
            </dd>
          </div>
          <div>
            <dt className="text-[10px] font-semibold uppercase tracking-wider text-muted">Peak</dt>
            <dd className="text-lg font-black leading-tight tabular-nums text-ink">
              {peak.toLocaleString()}
              <span className="ml-1 text-[11px] font-medium text-muted">
                /{range === 'days' ? 'day' : 'hr'}
              </span>
            </dd>
          </div>
          <div>
            <dt className="text-[10px] font-semibold uppercase tracking-wider text-muted">
              {range === 'days' ? 'vs yesterday' : 'vs last hour'}
            </dt>
            <dd
              className={cn(
                'text-lg font-black leading-tight tabular-nums',
                delta === null
                  ? 'text-muted'
                  : delta > 0
                    ? 'text-success'
                    : delta < 0
                      ? 'text-danger'
                      : 'text-ink',
              )}
            >
              {delta === null ? '—' : `${delta > 0 ? '+' : ''}${Math.round(delta)}%`}
            </dd>
          </div>
        </dl>
      </div>

      <TrendChart
        // Remounts on every switch so the draw-in animation replays, which is what
        // makes a tab change read as a new series rather than as the same line
        // jumping to new values.
        key={`${stream}-${range}`}
        series={[series]}
        label={`${DECK_LABEL[stream]}, ${RANGES[range].toLowerCase()}`}
        height={260}
        emptyText={
          range === 'days'
            ? 'Not enough days recorded yet'
            : 'Nothing recorded in the last 24 hours'
        }
      />
    </BoardPanel>
  );
}
