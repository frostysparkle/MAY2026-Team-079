import { useMemo } from 'react';
import { Briefcase, Crown } from 'lucide-react';
import {
  ActionMenu,
  IconTile,
  StatusBadge,
  type ActionMenuItem,
  type DataTableColumn,
} from '@/components/ui';
import { orDash, type StaffRow } from './staffDirectory';

/**
 * The staff table's columns.
 *
 * Kept beside the row model rather than inside the page because `sortRows` reads
 * the same `sortValue` functions the headers expose — one definition drives both
 * what a column shows and how it sorts, so the two can't drift.
 *
 * Blank fields sort to one end rather than being scattered by an empty string:
 * the accounts still missing a department are usually the ones being looked for.
 */
export function useStaffColumns({
  actionsFor,
}: {
  actionsFor: (row: StaffRow) => ActionMenuItem[];
}): DataTableColumn<StaffRow>[] {
  return useMemo(
    () => [
      {
        key: 'member',
        header: 'Member',
        sortValue: (row) => row.email,
        cell: (row) => (
          <div className="flex items-center gap-3">
            <IconTile
              icon={row.isSuperAdmin ? Crown : Briefcase}
              tone={row.isSuperAdmin ? 'warning' : 'brand'}
              size="sm"
            />
            <div className="min-w-0">
              <p className="truncate font-semibold text-ink">{row.email}</p>
              <p className="truncate text-xs text-muted">{row.id}</p>
            </div>
          </div>
        ),
      },
      {
        key: 'designation',
        header: 'Designation',
        sortValue: (row) => row.designation || 'zzz',
        cell: (row) => (
          <span className={row.designation ? 'text-ink' : 'text-muted'}>
            {orDash(row.designation)}
          </span>
        ),
      },
      {
        key: 'department',
        header: 'Department',
        sortValue: (row) => row.department || 'zzz',
        cell: (row) =>
          row.department === '' ? (
            <span className="text-muted" title="No department recorded">
              —
            </span>
          ) : (
            <StatusBadge tone="info">{row.department}</StatusBadge>
          ),
      },
      {
        key: 'role',
        header: 'Role',
        sortValue: (row) => row.role,
        // Shown exactly as stored: role is a free string on the backend, so a
        // prettified label could misrepresent a value this code has never seen.
        cell: (row) => <StatusBadge tone={row.roleTone}>{orDash(row.role)}</StatusBadge>,
      },
      {
        key: 'actions',
        header: 'Actions',
        align: 'right',
        cell: (row) => (
          <div className="flex items-center justify-end">
            <ActionMenu label={`Actions for ${row.email}`} items={actionsFor(row)} />
          </div>
        ),
      },
    ],
    [actionsFor],
  );
}
