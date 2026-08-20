import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { DOMAIN_COLOR, RankedBars, Sparkline, SplitBar, StatusBadge } from '@/components/ui';
import { cn } from '@/lib/cn';
import { path, ROUTES } from '@/config/routes';
import type { Event, EventParticipationResponse } from '@/api/types';
import type { AuditFeeds, TierState } from '../useFestSnapshot';
import { bucketByDay } from '../auditSeries';
import { buildEventRows, summariseEvents } from '../festMetrics';
import { Figure, FigureRow, OverviewPanel, PanelBlock } from '../OverviewPanel';
import { orDash, orDashPercent } from '../format';

/**
 * What is running, what is coming, and who signed up.
 *
 * The most expensive panel on the board — one participation call per event, with
 * no bulk form available — and the most load-bearing during the fest itself,
 * since "which events are live and is anyone scanning them" is the question an
 * admin asks most often.
 *
 * Registration and attendance totals are `null` unless *every* event was read.
 * A partial sum here would look like a real figure and understate the fest. The
 * same rule governs the entry-capacity block: it sums only events that publish a
 * limit, and only when every one of them was readable.
 */
export function EventsPanel({
  events,
  participation,
  audit,
  tier,
}: {
  events: Event[] | null;
  participation: Record<string, EventParticipationResponse>;
  audit: AuditFeeds;
  tier: TierState;
}) {
  const rows = useMemo(() => buildEventRows(events ?? [], participation), [events, participation]);
  const summary = useMemo(() => summariseEvents(rows), [rows]);

  // Registrations net of cancellations, per day — the shape of demand over time.
  const trend = useMemo(() => {
    const registers = bucketByDay(
      audit.eventRegistrations.filter((row) => row.action === 'EVENT_REGISTER'),
    );
    const cancels = new Map(
      bucketByDay(audit.eventRegistrations.filter((row) => row.action === 'EVENT_DEREGISTER')).map(
        (bucket) => [bucket.label, bucket.value],
      ),
    );
    return registers.map((bucket) => ({
      label: bucket.label,
      value: Math.max(0, bucket.value - (cancels.get(bucket.label) ?? 0)),
    }));
  }, [audit.eventRegistrations]);

  const top = useMemo(
    () =>
      summary.topByRegistrations.slice(0, 5).map((row) => ({
        key: row.id,
        label: row.name,
        value: row.registrations ?? 0,
      })),
    [summary.topByRegistrations],
  );

  return (
    <OverviewPanel
      domain="events"
      title="Events"
      subtitle={`${summary.total} events · ${summary.open} open for registration`}
      tier={tier}
      to={ROUTES.adminEvents}
      toLabel="Manage events"
      badge={
        summary.live > 0 ? (
          <StatusBadge tone="success">{summary.live} live now</StatusBadge>
        ) : (
          <StatusBadge tone="neutral">Nothing live</StatusBadge>
        )
      }
    >
      <FigureRow>
        <Figure
          label="Registrations"
          value={orDash(summary.registrations)}
          note={summary.registrations === null ? 'partial data' : 'across all events'}
        />
        <Figure
          label="Scans today"
          value={orDash(summary.scansToday)}
          note={`${orDashPercent(summary.attendanceRate)} of registrations`}
        />
        <Figure label="Live now" value={summary.live} tone={summary.live > 0 ? 'good' : 'muted'} />
        <Figure
          label="Starting soon"
          value={summary.startingSoon.length}
          note="next 6 hours"
          tone={summary.startingSoon.length > 0 ? 'warn' : 'muted'}
        />
      </FigureRow>

      <PanelBlock title="Scheduling">
        <SplitBar
          label="Events by phase"
          segments={[
            { key: 'live', label: 'Live', value: summary.live, color: 'var(--color-success)' },
            {
              key: 'upcoming',
              label: 'Upcoming',
              value: summary.upcoming,
              color: DOMAIN_COLOR.events,
            },
            { key: 'past', label: 'Done', value: summary.past, color: 'var(--color-line)' },
            {
              key: 'unscheduled',
              label: 'Unscheduled',
              value: summary.unscheduled,
              color: 'var(--color-warning)',
            },
          ]}
        />
      </PanelBlock>

      {summary.liveNow.length > 0 && (
        <PanelBlock title="Running right now">
          <ul className="flex list-none flex-col gap-1 p-0">
            {summary.liveNow.slice(0, 4).map((row) => (
              <li key={row.id}>
                <Link
                  to={path(ROUTES.eventParticipation, { eventId: row.id })}
                  className="tap flex items-baseline justify-between gap-3 rounded-lg px-1 py-0.5 hover:bg-surface-2"
                >
                  <span className="min-w-0 truncate text-xs font-medium text-ink">
                    {row.name}
                    {row.liveRound && <span className="text-muted"> · {row.liveRound}</span>}
                  </span>
                  <span className="shrink-0 text-xs font-semibold tabular-nums text-muted">
                    {orDash(row.scansToday)} scanned
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </PanelBlock>
      )}

      <PanelBlock title="Registrations per day, net of cancellations">
        <Sparkline
          points={trend}
          domain="events"
          label="Event registrations per day"
          caption={
            audit.truncated.includes('event registrations')
              ? 'Trail truncated — earlier days may be incomplete'
              : undefined
          }
        />
      </PanelBlock>

      <PanelBlock title="Most registered">
        <RankedBars
          rows={top}
          domain="events"
          label="Events with the most registrations"
          emptyText="No participation figures available"
        />
      </PanelBlock>

      {/* Story 3.2 at fest scale. Shown only when at least one organiser has
          published a capacity — a block reading "0 events near capacity" across
          a fest where nobody declared one says nothing. */}
      {summary.withCapacity > 0 && (
        <PanelBlock title="Entry capacity">
          <FigureRow>
            <Figure
              label="Entries left"
              value={orDash(summary.entriesLeft)}
              note={`across ${summary.withCapacity} event${summary.withCapacity === 1 ? '' : 's'} with a published limit`}
            />
            <Figure
              label="At capacity"
              value={summary.atCapacity.length}
              tone={summary.atCapacity.length > 0 ? 'bad' : 'muted'}
              note="today's scans have met the limit"
            />
          </FigureRow>
          {summary.nearCapacity.length > 0 && (
            <ul className="flex list-none flex-col gap-1 p-0">
              {summary.nearCapacity.slice(0, 4).map((row) => (
                <li key={row.id}>
                  <Link
                    to={path(ROUTES.eventParticipation, { eventId: row.id })}
                    className="tap flex items-baseline justify-between gap-3 rounded-lg px-1 py-0.5 hover:bg-surface-2"
                  >
                    <span className="min-w-0 truncate text-xs font-medium text-ink">
                      {row.name}
                    </span>
                    <span
                      className={cn(
                        'shrink-0 text-xs font-semibold tabular-nums',
                        row.capacity?.atCapacity ? 'text-danger' : 'text-warning',
                      )}
                    >
                      {row.capacity?.summary}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </PanelBlock>
      )}

      {summary.withoutRegistrations.length > 0 && (
        <p className="text-[11px] text-warning">
          {summary.withoutRegistrations.length} event
          {summary.withoutRegistrations.length === 1 ? ' has' : 's have'} no registrations yet.
        </p>
      )}
    </OverviewPanel>
  );
}
