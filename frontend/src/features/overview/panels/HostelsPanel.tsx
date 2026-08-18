import { useMemo } from 'react';
import { DOMAIN_COLOR, RankedBars, Sparkline, SplitBar, StatusBadge } from '@/components/ui';
import { ROUTES } from '@/config/routes';
import { OCCUPANCY_STATUS, occupancyStatus } from '@/features/occupancy';
import { buildHostelRows, summariseHostels } from '@/features/hostels/hostelOccupancy';
import type { Hostel, HostelStatisticsResponse, ParticipantStatisticsResponse } from '@/api/types';
import type { AuditFeeds, TierState } from '../useFestSnapshot';
import { bucketByHour, rowsOnDay } from '../auditSeries';
import { Figure, FigureRow, OverviewPanel, PanelBlock } from '../OverviewPanel';
import { orDash, orDashPercent } from '../format';

/**
 * Beds, who is on campus, and the allocation queue.
 *
 * The occupancy figures are computed by `hostelOccupancy`, the same module the
 * Hostels screen uses, so a block cannot read "Filling" there and something else
 * here. Check-in and check-out history comes from the audit trail, which is the
 * only place hostel scans are recorded.
 *
 * `hostel_pending` is preferred over the audit-derived estimate whenever
 * `/participants/statistics` loaded: the trail is truncated by `limit` and can
 * only ever produce a floor, while the participants endpoint counts the flag
 * itself and is exact.
 */
export function HostelsPanel({
  hostels,
  stats,
  audit,
  participants,
  tier,
}: {
  hostels: Hostel[] | null;
  stats: Record<string, HostelStatisticsResponse>;
  audit: AuditFeeds;
  participants: ParticipantStatisticsResponse | null;
  tier: TierState;
}) {
  const rows = useMemo(() => buildHostelRows(hostels ?? [], stats), [hostels, stats]);
  const summary = useMemo(() => summariseHostels(rows), [rows]);

  const inside = useMemo(
    () =>
      rows.every((row) => row.inside !== null)
        ? rows.reduce((sum, row) => sum + (row.inside ?? 0), 0)
        : null,
    [rows],
  );

  const checkInsToday = rowsOnDay(audit.hostelEntry).length;
  const checkOutsToday = rowsOnDay(audit.hostelExit).length;
  const entryTrend = useMemo(() => bucketByHour(audit.hostelEntry, 24), [audit.hostelEntry]);

  const fullest = useMemo(
    () =>
      [...rows]
        .filter((row) => row.percent !== null)
        .sort((a, b) => (b.percent ?? 0) - (a.percent ?? 0))
        .slice(0, 5)
        .map((row) => {
          const status = occupancyStatus(row.percent ?? 0);
          return {
            key: row.id,
            label: row.name,
            value: row.allocated ?? 0,
            max: row.capacity,
            display: `${(row.allocated ?? 0).toLocaleString()} / ${row.capacity.toLocaleString()}`,
            color:
              status === 'full'
                ? 'var(--color-danger)'
                : status === 'filling'
                  ? 'var(--color-warning)'
                  : DOMAIN_COLOR.hostels,
          };
        }),
    [rows],
  );

  const pending = participants?.hostel_pending ?? null;
  const outside = inside !== null && summary.allocated !== null ? summary.allocated - inside : null;

  return (
    <OverviewPanel
      domain="hostels"
      title="Hostels"
      subtitle={`${summary.hostels} blocks · ${summary.beds.toLocaleString()} beds`}
      tier={tier}
      to={ROUTES.adminHostels}
      toLabel="Manage hostels"
      badge={
        summary.percent !== null && (
          <StatusBadge tone={OCCUPANCY_STATUS[occupancyStatus(summary.percent)].tone}>
            {orDashPercent(summary.percent)} full
          </StatusBadge>
        )
      }
    >
      <FigureRow>
        <Figure label="Beds" value={summary.beds.toLocaleString()} />
        <Figure
          label="Allotted"
          value={orDash(summary.allocated)}
          note={orDashPercent(summary.percent)}
        />
        <Figure
          label="Free"
          value={orDash(summary.available)}
          tone={summary.available === 0 ? 'bad' : 'good'}
        />
        <Figure
          label="Pending"
          value={orDash(pending)}
          note={pending === null ? 'Needs participant totals' : 'Awaiting allocation'}
          tone={pending !== null && pending > 0 ? 'warn' : 'muted'}
        />
      </FigureRow>

      <PanelBlock title="On campus right now">
        <SplitBar
          label="Participants inside versus outside"
          segments={[
            {
              key: 'inside',
              label: 'Inside',
              value: inside ?? 0,
              color: DOMAIN_COLOR.hostels,
            },
            {
              key: 'outside',
              label: 'Out',
              value: Math.max(0, outside ?? 0),
              color: 'var(--color-line)',
            },
          ]}
        />
      </PanelBlock>

      <PanelBlock title="Check-ins, last 24 hours">
        <Sparkline
          points={entryTrend}
          domain="hostels"
          label="Hostel check-ins over the last 24 hours"
          caption={`${checkInsToday.toLocaleString()} in today · ${checkOutsToday.toLocaleString()} out${
            audit.truncated.includes('hostel check-ins') ? ' · trail truncated' : ''
          }`}
        />
      </PanelBlock>

      <PanelBlock title="Fullest blocks">
        <RankedBars
          rows={fullest}
          domain="hostels"
          label="Fullest hostel blocks"
          emptyText="No occupancy figures available"
        />
      </PanelBlock>
    </OverviewPanel>
  );
}
