import { useMemo } from 'react';
import { DOMAIN_COLOR, RankedBars, SlotHeatmap, StatusBadge } from '@/components/ui';
import { ROUTES } from '@/config/routes';
import { OCCUPANCY_STATUS, occupancyStatus } from '@/features/occupancy';
import { buildMessRows, summariseMess } from '@/features/mess/messOccupancy';
import type { Mess, MessStatisticsResponse } from '@/api/types';
import type { AuditFeeds, TierState } from '../useFestSnapshot';
import { mealMatrix, rowsOnDay, uniqueSubjects } from '../auditSeries';
import { Figure, FigureRow, OverviewPanel, PanelBlock } from '../OverviewPanel';
import { orDash, orDashPercent } from '../format';

const SLOT_LABEL: Record<string, string> = {
  breakfast: 'Break',
  lunch: 'Lunch',
  dinner: 'Dinner',
};

/**
 * Seats, meals served, and the fest's eating rhythm.
 *
 * Allocation comes from the per-hall statistics endpoints. Everything about
 * actual *eating* is reconstructed from `MESS_SCAN` audit rows, which carry the
 * slot, the fest day, and the participant — a genuinely rich source, and the
 * only one: there is no mess logs endpoint.
 *
 * The day × slot heatmap is the one view on the board that shows the whole fest
 * at once, and it is also the figure most sensitive to the audit `limit`, which
 * is why a truncated trail is called out rather than quietly under-reported.
 */
export function MessPanel({
  mess,
  stats,
  audit,
  tier,
}: {
  mess: Mess[] | null;
  stats: Record<string, MessStatisticsResponse>;
  audit: AuditFeeds;
  tier: TierState;
}) {
  const rows = useMemo(() => buildMessRows(mess ?? [], stats), [mess, stats]);
  const summary = useMemo(() => summariseMess(rows), [rows]);

  const scansToday = useMemo(() => rowsOnDay(audit.messScans), [audit.messScans]);
  const matrix = useMemo(() => mealMatrix(audit.messScans), [audit.messScans]);
  const todayMatrix = useMemo(() => mealMatrix(scansToday), [scansToday]);
  const dinersToday = useMemo(() => uniqueSubjects(scansToday).size, [scansToday]);

  const turnout =
    summary.allocated !== null && summary.allocated > 0
      ? (dinersToday / summary.allocated) * 100
      : null;

  const busiest = useMemo(() => {
    const perHall = new Map<string, number>();
    for (const row of scansToday) {
      if (row.target_id) perHall.set(row.target_id, (perHall.get(row.target_id) ?? 0) + 1);
    }
    return [...perHall.entries()]
      .map(([id, value]) => ({
        key: id,
        label: rows.find((row) => row.id === id)?.name ?? id,
        value,
      }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 5);
  }, [scansToday, rows]);

  const truncated = audit.truncated.includes('meal scans');

  return (
    <OverviewPanel
      domain="mess"
      title="Mess"
      subtitle={`${summary.halls} halls · ${summary.seats.toLocaleString()} seats`}
      tier={tier}
      to={ROUTES.adminMess}
      toLabel="Manage mess"
      badge={
        summary.percent !== null && (
          <StatusBadge tone={OCCUPANCY_STATUS[occupancyStatus(summary.percent)].tone}>
            {orDashPercent(summary.percent)} allotted
          </StatusBadge>
        )
      }
    >
      <FigureRow>
        <Figure
          label="Diners allotted"
          value={orDash(summary.allocated)}
          note={`of ${summary.seats.toLocaleString()} seats`}
        />
        <Figure
          label="Meals today"
          value={todayMatrix.total.toLocaleString()}
          note={truncated ? 'trail truncated' : 'swipes recorded'}
        />
        <Figure label="Unique diners" value={dinersToday.toLocaleString()} note="today" />
        <Figure
          label="Turnout"
          value={orDashPercent(turnout)}
          note="of allotted diners"
          tone={turnout !== null && turnout < 40 ? 'warn' : 'default'}
        />
      </FigureRow>

      <PanelBlock title="Today by sitting">
        <RankedBars
          rows={(['breakfast', 'lunch', 'dinner'] as const).map((slot) => ({
            key: slot,
            label: SLOT_LABEL[slot],
            value: todayMatrix.bySlot[slot],
          }))}
          domain="mess"
          label="Meals served today by sitting"
          emptyText="No meals scanned today"
        />
      </PanelBlock>

      <PanelBlock title="Every sitting, whole fest">
        <SlotHeatmap
          rows={matrix.days}
          columns={['breakfast', 'lunch', 'dinner']}
          cells={matrix.cells}
          label="Meals served by fest day and sitting"
          columnLabel={(column) => SLOT_LABEL[column] ?? column}
        />
      </PanelBlock>

      <PanelBlock title="Busiest halls today">
        <RankedBars
          rows={busiest}
          domain="mess"
          label="Busiest mess halls today"
          emptyText="No meals scanned today"
        />
      </PanelBlock>

      {busiest.length === 0 && rows.length > 0 && (
        <p className="text-[11px] text-muted" style={{ color: DOMAIN_COLOR.mess }}>
          Halls are allotted but nothing has been scanned yet today.
        </p>
      )}
    </OverviewPanel>
  );
}
