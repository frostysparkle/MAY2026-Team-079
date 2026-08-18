import { useMemo } from 'react';
import { Histogram, RankedBars, SplitBar, StatusBadge } from '@/components/ui';
import { ROUTES } from '@/config/routes';
import type { BackendTeamMember, Event, Hostel, Mess, Workshop } from '@/api/types';
import type { AuditFeeds, TierState } from '../useFestSnapshot';
import { rowsOnDay, uniqueActors } from '../auditSeries';
import { buildStaffWorkload, summariseStaffOps } from '../festMetrics';
import { Figure, FigureRow, OverviewPanel, PanelBlock } from '../OverviewPanel';
import { orDashPercent } from '../format';

/**
 * Who is on the team, who is actually working, and who cannot scan.
 *
 * Workload costs nothing extra: `event_team`, `mess_team`, `hostel_team` and
 * `workshop_team` all arrive with the entity lists the other panels already
 * fetched, so a staffer's duties are simply a join across data in memory.
 *
 * The muted-scanner figure is the reason this panel earns its place. A volunteer
 * whose `logging` flag is off gets a 403 at the turnstile and the queue backs up
 * with nobody upstream knowing — it is a silent failure that no other screen
 * surfaces at fest scale.
 */
export function StaffPanel({
  staff,
  events,
  mess,
  hostels,
  workshops,
  audit,
  tier,
}: {
  staff: BackendTeamMember[] | null;
  events: Event[] | null;
  mess: Mess[] | null;
  hostels: Hostel[] | null;
  workshops: Workshop[] | null;
  audit: AuditFeeds;
  tier: TierState;
}) {
  const activeIds = useMemo(() => uniqueActors(rowsOnDay(audit.recent)), [audit.recent]);

  const rows = useMemo(
    () =>
      buildStaffWorkload(
        staff ?? [],
        {
          events: events ?? [],
          mess: mess ?? [],
          hostels: hostels ?? [],
          workshops: workshops ?? [],
        },
        activeIds,
      ),
    [staff, events, mess, hostels, workshops, activeIds],
  );
  const summary = useMemo(() => summariseStaffOps(rows), [rows]);

  const byDepartment = useMemo(
    () =>
      summary.byDepartment.slice(0, 5).map((entry) => ({
        key: entry.department,
        label: entry.department,
        value: entry.count,
      })),
    [summary.byDepartment],
  );

  const activeShare = summary.accounts > 0 ? (summary.activeToday / summary.accounts) * 100 : null;

  return (
    <OverviewPanel
      domain="staff"
      title="Staff & Volunteers"
      subtitle={`${summary.accounts} accounts · ${summary.byDepartment.length} departments`}
      tier={tier}
      to={ROUTES.adminBackendTeams}
      toLabel="Manage staff"
      badge={
        summary.mutedAssignments > 0 ? (
          <StatusBadge tone="danger">{summary.mutedAssignments} scanners off</StatusBadge>
        ) : (
          <StatusBadge tone="success">All scanners on</StatusBadge>
        )
      }
    >
      <FigureRow>
        <Figure label="Accounts" value={summary.accounts.toLocaleString()} />
        <Figure
          label="Active today"
          value={summary.activeToday.toLocaleString()}
          note={`${orDashPercent(activeShare)} of the team`}
          tone={summary.activeToday === 0 ? 'muted' : 'good'}
        />
        <Figure
          label="No duty"
          value={summary.unassigned.toLocaleString()}
          note="on no team"
          tone={summary.unassigned > 0 ? 'warn' : 'good'}
        />
        <Figure
          label="Scanners off"
          value={summary.mutedAssignments.toLocaleString()}
          note="assignments that cannot scan"
          tone={summary.mutedAssignments > 0 ? 'bad' : 'good'}
        />
      </FigureRow>

      <PanelBlock title="Assignment">
        <SplitBar
          label="Staff with and without an assigned duty"
          segments={[
            {
              key: 'assigned',
              label: 'Assigned',
              value: summary.assigned,
              color: 'var(--color-domain-staff)',
            },
            {
              key: 'unassigned',
              label: 'Unassigned',
              value: summary.unassigned,
              color: 'var(--color-line)',
            },
          ]}
        />
      </PanelBlock>

      <PanelBlock title="Duties per staffer">
        <Histogram
          buckets={summary.workloadBuckets}
          domain="staff"
          label="Staff by number of assigned duties"
        />
      </PanelBlock>

      <PanelBlock title="By department">
        <RankedBars
          rows={byDepartment}
          domain="staff"
          label="Staff accounts by department"
          emptyText="No staff accounts"
        />
      </PanelBlock>

      {summary.staffWithMuted.length > 0 && (
        <p className="text-[11px] text-danger">
          {summary.staffWithMuted
            .slice(0, 3)
            .map((row) => row.email)
            .join(', ')}
          {summary.staffWithMuted.length > 3 && ` +${summary.staffWithMuted.length - 3} more`} —
          scanning switched off.
        </p>
      )}
    </OverviewPanel>
  );
}
