import { useMemo } from 'react';
import { Eye, UtensilsCrossed } from 'lucide-react';
import {
  ActionMenu,
  IconTile,
  ProgressBar,
  ProgressRing,
  StatusBadge,
  type ActionMenuItem,
  type DataTableColumn,
} from '@/components/ui';
import { occupancyTone } from '@/features/occupancy';
import { type MessRow } from './messOccupancy';

/**
 * The mess table's columns.
 *
 * Kept beside the row model rather than inside the page because `sortRows` reads
 * the same `sortValue` functions the headers expose — one definition drives both
 * what a column shows and how it sorts, so the two can't drift.
 *
 * TYPE and REGION are separate columns on purpose: the dietary designation
 * decides who is allocated to the hall, the regional menu does not. Unreadable
 * occupancy sorts to the bottom (`-1`) instead of counting as zero, matching how
 * those cells render as a dash.
 */
export function useMessColumns({
  onView,
  actionsFor,
}: {
  onView: (row: MessRow) => void;
  actionsFor: (row: MessRow) => ActionMenuItem[];
}): DataTableColumn<MessRow>[] {
  return useMemo(
    () => [
      {
        key: 'hall',
        header: 'Mess hall',
        sortValue: (row) => row.name,
        cell: (row) => (
          <div className="flex items-center gap-3">
            <IconTile icon={UtensilsCrossed} size="sm" tone="warning" />
            <div className="min-w-0">
              <p className="truncate font-semibold text-ink">{row.name}</p>
              <p className="truncate text-xs text-muted">{row.id}</p>
            </div>
          </div>
        ),
      },
      {
        key: 'type',
        header: 'Diet',
        sortValue: (row) => row.dietLabel,
        cell: (row) => <StatusBadge tone={row.dietTone}>{row.dietLabel}</StatusBadge>,
      },
      {
        key: 'region',
        header: 'Region',
        // Halls with no menu declared sort together at one end rather than being
        // scattered through the alphabet by an empty string.
        sortValue: (row) => row.cuisineLabel ?? 'zzz',
        cell: (row) =>
          row.cuisineLabel === null ? (
            // An em dash, not an empty cell: "none declared" is a fact worth
            // showing, and a blank cell reads as a rendering failure.
            <span className="text-muted" title="No regional menu declared">
              —
            </span>
          ) : (
            <StatusBadge tone="warning">{row.cuisineLabel}</StatusBadge>
          ),
      },
      {
        key: 'capacity',
        header: 'Capacity',
        sortValue: (row) => row.capacity,
        cell: (row) => (
          <div className="leading-tight">
            <span className="font-semibold tabular-nums text-ink">{row.capacity}</span>
            <span className="block text-xs text-muted">seats</span>
          </div>
        ),
      },
      {
        key: 'occupancy',
        header: 'Occupancy',
        sortValue: (row) => row.allocated ?? -1,
        className: 'w-44',
        cell: (row) =>
          row.allocated === null ? (
            <span className="text-muted">—</span>
          ) : (
            <div className="flex flex-col gap-1.5">
              <p className="text-xs tabular-nums">
                <span className="font-semibold text-ink">{row.allocated}</span>
                <span className="text-muted"> / {row.capacity}</span>
              </p>
              <ProgressBar
                value={row.allocated}
                max={row.capacity}
                tone={occupancyTone(row.status ?? 'empty')}
                label={`${row.name} occupancy`}
              />
            </div>
          ),
      },
      {
        key: 'available',
        header: 'Available',
        align: 'center',
        sortValue: (row) => row.available ?? -1,
        cell: (row) =>
          row.available === null ? (
            <span className="text-muted">—</span>
          ) : (
            <span className="font-semibold tabular-nums text-success">{row.available}</span>
          ),
      },
      {
        key: 'percent',
        header: 'Occupancy %',
        align: 'center',
        sortValue: (row) => row.percent ?? -1,
        cell: (row) =>
          row.percent === null ? (
            <span className="text-muted">—</span>
          ) : (
            <div className="flex justify-center">
              <ProgressRing
                value={row.allocated ?? 0}
                max={row.capacity}
                tone={occupancyTone(row.status ?? 'empty')}
                label={`${row.name} occupancy percentage`}
              />
            </div>
          ),
      },
      {
        key: 'actions',
        header: 'Actions',
        align: 'right',
        cell: (row) => (
          <div className="flex items-center justify-end gap-1">
            <button
              type="button"
              onClick={() => onView(row)}
              aria-label={`View ${row.name}`}
              // Matches ActionMenu's trigger chip so the two sit as a pair.
              className="tap flex h-9 w-9 items-center justify-center rounded-full bg-surface text-muted shadow-card ring-1 ring-line hover:bg-brand-50 hover:text-brand active:scale-95"
            >
              <Eye size={16} strokeWidth={2.25} aria-hidden />
            </button>
            <ActionMenu label={`Actions for ${row.name}`} items={actionsFor(row)} />
          </div>
        ),
      },
    ],
    [onView, actionsFor],
  );
}
