import { useMemo } from 'react';
import { Phone } from 'lucide-react';
import { Avatar, StatusBadge, type DataTableColumn } from '@/components/ui';
import { isReachablePhone } from './eventTeam';
import type { EventRegistrant } from './eventRoster';

/**
 * The registrant table's columns — the List view behind `EventParticipationView`'s
 * view toggle. Kept beside the row model, matching `hostelColumns`/`messColumns`:
 * one definition of what a column shows also drives how it sorts.
 */
export function useRegistrantColumns(): DataTableColumn<EventRegistrant>[] {
  return useMemo(
    () => [
      {
        key: 'name',
        header: 'Registrant',
        sortValue: (row) => row.name || row.participantId,
        cell: (row) => (
          <div className="flex items-center gap-3">
            <Avatar src={row.photo} name={row.name ?? row.email} size={32} />
            <div className="min-w-0">
              <p className="truncate font-medium text-ink">{row.name || row.participantId}</p>
              <p className="truncate text-xs text-muted">{row.email}</p>
            </div>
          </div>
        ),
      },
      {
        key: 'id',
        header: 'ID',
        sortValue: (row) => row.participantId,
        cell: (row) => <span className="text-xs tabular-nums text-muted">{row.participantId}</span>,
      },
      {
        key: 'house',
        header: 'House',
        sortValue: (row) => row.house ?? '',
        cell: (row) => row.house ?? <span className="text-muted">—</span>,
      },
      {
        key: 'programme',
        header: 'Programme',
        sortValue: (row) => row.programme ?? '',
        cell: (row) =>
          [row.programme, row.entryYear === null ? null : `${row.entryYear} entry`]
            .filter(Boolean)
            .join(' · ') || <span className="text-muted">—</span>,
      },
      {
        key: 'team',
        header: 'Team',
        sortValue: (row) => row.teamId ?? '',
        cell: (row) =>
          row.teamId ? (
            <StatusBadge tone="info">
              {row.teamId} · {row.teamRole}
            </StatusBadge>
          ) : (
            <span className="text-muted">—</span>
          ),
      },
      {
        key: 'phone',
        header: 'Phone',
        align: 'right',
        cell: (row) =>
          isReachablePhone(row.phone) ? (
            <a
              href={`tel:${row.phone}`}
              className="inline-flex items-center gap-1 text-xs font-medium text-brand underline"
            >
              <Phone size={11} strokeWidth={2.5} />
              {row.phone}
            </a>
          ) : (
            <span className="text-muted">—</span>
          ),
      },
    ],
    [],
  );
}
