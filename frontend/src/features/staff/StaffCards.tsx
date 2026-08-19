import { Briefcase, Crown } from 'lucide-react';
import { ActionMenu, Card, IconTile, StatusBadge, type ActionMenuItem } from '@/components/ui';
import { orDash, type StaffRow } from './staffDirectory';

/**
 * The card layout for the staff directory — one account at a time.
 *
 * This is the default view, unlike hostels and mess halls. Those default to a
 * table because their rows are numbers, and a column of numbers is what makes
 * them comparable. A staff account is four short strings, so the table earns
 * nothing by default and the cards read better at two-up; the table stays behind
 * the toggle for when someone is checking roles or departments down a column.
 */
export function StaffCards({
  rows,
  actionsFor,
}: {
  rows: StaffRow[];
  actionsFor: (row: StaffRow) => ActionMenuItem[];
}) {
  return (
    <ul className="grid gap-3 lg:grid-cols-2">
      {rows.map((row) => (
        <li key={row.id}>
          <Card className="flex h-full items-start gap-3">
            <IconTile
              icon={row.isSuperAdmin ? Crown : Briefcase}
              tone={row.isSuperAdmin ? 'warning' : 'brand'}
              size="sm"
            />
            <div className="min-w-0 flex-1">
              <p className="truncate font-semibold text-ink">{row.email}</p>
              <p className="truncate text-sm text-muted">
                {orDash(row.designation)} · {orDash(row.department)}
              </p>
              <StatusBadge tone={row.roleTone} className="mt-1.5">
                {orDash(row.role)}
              </StatusBadge>
            </div>
            <ActionMenu label={`Actions for ${row.email}`} items={actionsFor(row)} />
          </Card>
        </li>
      ))}
    </ul>
  );
}
