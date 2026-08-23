import { useMemo } from 'react';
import { Button, StatusBadge, type DataTableColumn } from '@/components/ui';
import { levelLabel, type RosterEntry } from './workshopRoster';

/**
 * The roster table's columns — the List view behind `WorkshopManagePage`'s view
 * toggle. Kept beside the row model, matching `hostelColumns`/`messColumns`: one
 * definition of what a column shows also drives how it sorts.
 */
export function useRosterColumns({
  canCorrect,
  savingId,
  onToggleAttendance,
}: {
  canCorrect: boolean;
  savingId: string | null;
  onToggleAttendance: (entry: RosterEntry) => void;
}): DataTableColumn<RosterEntry>[] {
  return useMemo(() => {
    const columns: DataTableColumn<RosterEntry>[] = [
      {
        key: 'name',
        header: 'Registrant',
        sortValue: (row) => row.name || row.participantId,
        cell: (row) => (
          <div className="min-w-0">
            <p className="truncate font-medium text-ink">{row.name || row.participantId}</p>
            {row.name && (
              <p className="truncate text-xs text-muted">{row.participantId}</p>
            )}
            {row.email && <p className="truncate text-xs text-muted">{row.email}</p>}
          </div>
        ),
      },
      {
        key: 'programme',
        header: 'Programme',
        sortValue: (row) => row.programLabel ?? '',
        cell: (row) => row.programLabel ?? <span className="text-muted">—</span>,
      },
      {
        key: 'level',
        header: 'Level',
        sortValue: (row) => row.courseStage ?? '',
        cell: (row) =>
          row.courseStage ? (
            <StatusBadge tone="neutral">{row.academicLevel ?? levelLabel(row.courseStage)}</StatusBadge>
          ) : (
            <span className="text-muted">—</span>
          ),
      },
      {
        key: 'booking',
        header: 'Booking',
        sortValue: (row) => row.booking,
        cell: (row) => (
          <StatusBadge tone={row.booking === 'on-spot' ? 'info' : 'neutral'}>
            {row.booking === 'on-spot' ? 'On-spot' : 'Pre-registered'}
          </StatusBadge>
        ),
      },
      {
        key: 'attended',
        header: 'Status',
        sortValue: (row) => (row.attended ? 1 : 0),
        cell: (row) => (
          <StatusBadge tone={row.attended ? 'success' : 'warning'}>
            {row.attended ? 'Present' : 'Not scanned'}
          </StatusBadge>
        ),
      },
      {
        key: 'timestamps',
        header: 'Recorded',
        cell: (row) => (
          <span className="whitespace-nowrap text-xs text-muted">
            {[
              row.registeredAt ? `booked ${new Date(row.registeredAt).toLocaleString('en-IN')}` : null,
              row.attendedAt ? `scanned ${new Date(row.attendedAt).toLocaleString('en-IN')}` : null,
            ]
              .filter(Boolean)
              .join(' · ') || '—'}
          </span>
        ),
      },
    ];

    if (canCorrect) {
      columns.push({
        key: 'actions',
        header: 'Actions',
        srOnlyHeader: true,
        align: 'right',
        cell: (row) => (
          <Button
            size="sm"
            variant="secondary"
            loading={savingId === row.participantId}
            disabled={savingId !== null}
            onClick={() => onToggleAttendance(row)}
          >
            {row.attended ? 'Mark absent' : 'Mark present'}
          </Button>
        ),
      });
    }

    return columns;
  }, [canCorrect, savingId, onToggleAttendance]);
}
