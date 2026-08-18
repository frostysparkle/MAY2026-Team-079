import { Building2, Eye } from 'lucide-react';
import {
  ActionMenu,
  Card,
  IconTile,
  ProgressBar,
  ProgressRing,
  StatusBadge,
  type ActionMenuItem,
} from '@/components/ui';
import { OCCUPANCY_STATUS, occupancyTone } from '@/features/occupancy';
import { type HostelRow } from './hostelOccupancy';

/**
 * The card layout behind the view toggle — the same rows, one block at a time.
 *
 * The table is better for comparing figures down a column; this is better on a
 * phone, and better when someone is looking at one block rather than ranking all
 * of them. Both read the same `HostelRow`, so the two views can never disagree.
 */
export function HostelCards({
  rows,
  onView,
  actionsFor,
}: {
  rows: HostelRow[];
  onView: (row: HostelRow) => void;
  actionsFor: (row: HostelRow) => ActionMenuItem[];
}) {
  return (
    <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {rows.map((row) => {
        const status = row.status ? OCCUPANCY_STATUS[row.status] : null;
        return (
          <li key={row.id}>
            <Card className="flex h-full flex-col gap-3">
              <div className="flex items-start gap-3">
                <IconTile
                  icon={Building2}
                  size="sm"
                  tone={row.category === 'women' ? 'danger' : 'brand'}
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold text-ink">{row.name}</p>
                  <p className="truncate text-xs text-muted">
                    {row.id} · {row.capacity} beds
                  </p>
                </div>
                {row.percent !== null && (
                  <ProgressRing
                    value={row.allocated ?? 0}
                    max={row.capacity}
                    tone={occupancyTone(row.status ?? 'empty')}
                    label={`${row.name} occupancy percentage`}
                  />
                )}
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                <StatusBadge tone={row.category === 'women' ? 'danger' : 'info'}>
                  {row.categoryLabel}
                </StatusBadge>
                {status && <StatusBadge tone={status.tone}>{status.label}</StatusBadge>}
              </div>

              {row.allocated !== null && (
                <div className="flex flex-col gap-1.5">
                  <p className="flex items-baseline justify-between text-xs tabular-nums">
                    <span>
                      <span className="font-semibold text-ink">{row.allocated}</span>
                      <span className="text-muted"> / {row.capacity} allocated</span>
                    </span>
                    <span className="font-semibold text-success">{row.available} free</span>
                  </p>
                  <ProgressBar
                    value={row.allocated}
                    max={row.capacity}
                    tone={occupancyTone(row.status ?? 'empty')}
                    label={`${row.name} occupancy`}
                  />
                </div>
              )}

              <div className="mt-auto flex items-center justify-end gap-1 pt-1">
                <button
                  type="button"
                  onClick={() => onView(row)}
                  aria-label={`View ${row.name}`}
                  className="tap flex h-9 w-9 items-center justify-center rounded-full bg-surface text-muted shadow-card ring-1 ring-line hover:bg-brand-50 hover:text-brand active:scale-95"
                >
                  <Eye size={16} strokeWidth={2.25} aria-hidden />
                </button>
                <ActionMenu label={`Actions for ${row.name}`} items={actionsFor(row)} />
              </div>
            </Card>
          </li>
        );
      })}
    </ul>
  );
}
