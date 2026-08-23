import { Button, Card, StatusBadge } from '@/components/ui';
import { levelLabel, type RosterEntry } from './workshopRoster';

/**
 * The card layout behind the view toggle — one registrant at a time, in a grid
 * rather than the single-column list this used to be the only shape of.
 *
 * Mirrors `HostelCards` / `MessCards` / `StaffCards`: the table (see
 * `rosterColumns`) is better for scanning a column of names or timestamps; this
 * is better on a phone, and better when someone is looking up one registrant
 * rather than comparing many. Both read the same `RosterEntry`, so the two views
 * can never disagree.
 */
export function RosterCards({
  rows,
  canCorrect,
  savingId,
  onToggleAttendance,
}: {
  rows: RosterEntry[];
  /** Whether the "Mark present/absent" override is offered at all. */
  canCorrect: boolean;
  /** The participant id whose correction is in flight, so only that card is busy. */
  savingId: string | null;
  onToggleAttendance: (entry: RosterEntry) => void;
}) {
  return (
    <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {rows.map((entry) => (
        <li key={`${entry.participantId}-${entry.booking}`}>
          <Card className="flex h-full flex-col gap-3">
            <div className="min-w-0">
              <p className="truncate font-semibold text-ink">
                {entry.name || entry.participantId}
              </p>
              <p className="truncate text-xs text-muted">
                {[
                  entry.name ? entry.participantId : null,
                  entry.email,
                  entry.programLabel,
                  entry.registeredAt
                    ? `booked ${new Date(entry.registeredAt).toLocaleString('en-IN')}`
                    : null,
                  entry.attendedAt
                    ? `scanned ${new Date(entry.attendedAt).toLocaleString('en-IN')}`
                    : null,
                ]
                  .filter(Boolean)
                  .join(' · ') || 'No further detail is exposed for this id'}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              {entry.courseStage && (
                <StatusBadge tone="neutral">
                  {entry.academicLevel ?? levelLabel(entry.courseStage)}
                </StatusBadge>
              )}
              <StatusBadge tone={entry.booking === 'on-spot' ? 'info' : 'neutral'}>
                {entry.booking === 'on-spot' ? 'On-spot' : 'Pre-registered'}
              </StatusBadge>
              <StatusBadge tone={entry.attended ? 'success' : 'warning'}>
                {entry.attended ? 'Present' : 'Not scanned'}
              </StatusBadge>
            </div>

            {canCorrect && (
              <div className="mt-auto flex justify-end pt-1">
                <Button
                  size="sm"
                  variant="secondary"
                  loading={savingId === entry.participantId}
                  disabled={savingId !== null}
                  onClick={() => onToggleAttendance(entry)}
                >
                  {entry.attended ? 'Mark absent' : 'Mark present'}
                </Button>
              </div>
            )}
          </Card>
        </li>
      ))}
    </ul>
  );
}
