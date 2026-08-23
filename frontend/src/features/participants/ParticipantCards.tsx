import { Pencil } from 'lucide-react';
import type { ParticipantRecord } from '@/api/types';
import { Avatar, Button, Card, StatusBadge } from '@/components/ui';
import { displayName, hostelLabel, signupLabel, standingOf } from './participantAdmin';

/**
 * The card layout behind the view toggle — one participant at a time.
 *
 * Mirrors `HostelCards` / `MessCards` / `StaffCards`: the table is better for
 * scanning a column of names or houses, this is better on a phone and better
 * when someone is looking up one person rather than comparing many. Both read
 * the same `ParticipantRecord`, so the two views can never disagree.
 */
export function ParticipantCards({
  rows,
  hostels,
  onEdit,
}: {
  rows: ParticipantRecord[];
  hostels: Record<string, string>;
  onEdit: (participant: ParticipantRecord) => void;
}) {
  return (
    <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {rows.map((row) => {
        const standing = standingOf(row);
        const stay = hostelLabel(row, hostels);
        return (
          <li key={row.participant_id}>
            <Card className="flex h-full flex-col gap-3">
              <div className="flex items-start gap-3">
                <Avatar name={displayName(row)} size={40} />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold text-ink">{displayName(row)}</p>
                  <p className="truncate text-xs text-muted">{row.email}</p>
                  <p className="truncate text-xs tabular-nums text-muted">{row.participant_id}</p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                {row.profile?.house && <StatusBadge tone="neutral">{row.profile.house}</StatusBadge>}
                {standing.profileComplete ? (
                  <StatusBadge tone="success">Complete</StatusBadge>
                ) : (
                  <StatusBadge tone="warning">Needs detail</StatusBadge>
                )}
              </div>

              <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
                <div>
                  <dt className="text-muted">Stay</dt>
                  <dd className="truncate font-medium text-ink">{stay ?? 'Not allotted'}</dd>
                </div>
                <div>
                  <dt className="text-muted">Signed up</dt>
                  <dd className="truncate font-medium text-ink">{signupLabel(row)}</dd>
                </div>
              </dl>

              <div className="mt-auto flex items-center justify-end gap-1 pt-1">
                <Button variant="secondary" size="sm" onClick={() => onEdit(row)}>
                  <Pencil size={13} strokeWidth={2.5} /> Edit
                </Button>
              </div>
            </Card>
          </li>
        );
      })}
    </ul>
  );
}
