import { useMemo } from 'react';
import { RankedBars, SplitBar, StatusBadge } from '@/components/ui';
import { ROUTES } from '@/config/routes';
import { occupancyStatus } from '@/features/occupancy';
import type { Workshop } from '@/api/types';
import type { TierState } from '../useFestSnapshot';
import { buildWorkshopRows, summariseWorkshops } from '../festMetrics';
import { Figure, FigureRow, OverviewPanel, PanelBlock } from '../OverviewPanel';
import { orDashPercent } from '../format';

/**
 * Seats, bookings, and how many people actually turned up.
 *
 * The cheapest panel on the board: `GET /workshops` already carries `capacity`,
 * `registration_count` and `participant_count`, so every figure here comes from
 * a single request with no fan-out at all.
 *
 * Show-rate — attended over registered — is the number this panel exists for.
 * Nothing else in the app surfaces it, and it is the difference between a
 * workshop that sold out and a workshop that happened.
 *
 * `GET /workshops/{id}/seats/stream` is deliberately not used here. It is a
 * per-workshop SSE feed, and opening one stream per workshop from a dashboard
 * would trade dozens of held connections for freshness this panel does not need.
 */
export function WorkshopsPanel({
  workshops,
  tier,
}: {
  workshops: Workshop[] | null;
  tier: TierState;
}) {
  const rows = useMemo(() => buildWorkshopRows(workshops ?? []), [workshops]);
  const summary = useMemo(() => summariseWorkshops(rows), [rows]);

  const fullest = useMemo(
    () =>
      summary.fullest.slice(0, 5).map((row) => ({
        key: row.id,
        label: row.name,
        value: row.registrations,
        max: row.capacity,
        display: `${row.registrations.toLocaleString()} / ${row.capacity.toLocaleString()}`,
        color: row.soldOut ? 'var(--color-danger)' : undefined,
      })),
    [summary.fullest],
  );

  return (
    <OverviewPanel
      domain="workshops"
      title="Workshops"
      subtitle={`${summary.total} workshops · ${summary.capacity.toLocaleString()} seats`}
      tier={tier}
      to={ROUTES.adminWorkshops}
      toLabel="Manage workshops"
      badge={
        summary.fillPercent !== null && (
          <StatusBadge
            tone={
              occupancyStatus(summary.fillPercent) === 'full'
                ? 'danger'
                : occupancyStatus(summary.fillPercent) === 'filling'
                  ? 'warning'
                  : 'success'
            }
          >
            {orDashPercent(summary.fillPercent)} booked
          </StatusBadge>
        )
      }
    >
      <FigureRow>
        <Figure
          label="Seats booked"
          value={summary.registrations.toLocaleString()}
          note={`${summary.seatsLeft.toLocaleString()} left`}
        />
        <Figure label="Attended" value={summary.attended.toLocaleString()} note="scanned in" />
        <Figure
          label="Show rate"
          value={orDashPercent(summary.showRate)}
          note="turned up vs booked"
          tone={summary.showRate !== null && summary.showRate < 50 ? 'warn' : 'good'}
        />
        <Figure
          label="Sold out"
          value={summary.soldOut}
          note={`${summary.empty} with no bookings`}
          tone={summary.soldOut > 0 ? 'warn' : 'muted'}
        />
      </FigureRow>

      <PanelBlock title="Booked versus attended">
        <SplitBar
          label="Workshop seats booked, attended, and unclaimed"
          segments={[
            {
              key: 'attended',
              label: 'Attended',
              value: summary.attended,
              color: 'var(--color-domain-workshops)',
            },
            {
              key: 'noshow',
              label: 'Booked, not scanned',
              value: Math.max(0, summary.registrations - summary.attended),
              color: 'var(--color-warning)',
            },
            {
              key: 'free',
              label: 'Unsold',
              value: summary.seatsLeft,
              color: 'var(--color-line)',
            },
          ]}
        />
      </PanelBlock>

      <PanelBlock title="Fullest workshops">
        <RankedBars
          rows={fullest}
          domain="workshops"
          label="Fullest workshops"
          emptyText="No workshops published"
        />
      </PanelBlock>

      {summary.poorTurnout.length > 0 && (
        <p className="text-[11px] text-warning">
          {summary.poorTurnout.length} workshop
          {summary.poorTurnout.length === 1 ? '' : 's'} ran at under half the booked turnout.
        </p>
      )}
    </OverviewPanel>
  );
}
