import { Phone } from 'lucide-react';
import { Avatar, Card, StatusBadge } from '@/components/ui';
import { isReachablePhone } from './eventTeam';
import type { EventRegistrant } from './eventRoster';

/**
 * The card layout behind the view toggle — one registrant at a time.
 *
 * Mirrors `HostelCards` / `MessCards` / `ParticipantCards`: the table (see
 * `registrantColumns`) is better for scanning a column of names or houses, this
 * is better on a phone and better when someone is looking up one registrant
 * rather than comparing many. Both read the same `EventRegistrant`, so the two
 * views can never disagree.
 */
export function RegistrantCards({ rows }: { rows: EventRegistrant[] }) {
  return (
    <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {rows.map((p) => (
        <li key={p.participantId}>
          <Card className="flex h-full flex-col gap-3">
            <div className="flex items-start gap-3">
              <Avatar src={p.photo} name={p.name ?? p.email} size={40} />
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold text-ink">{p.name || p.participantId}</p>
                <p className="truncate text-xs text-muted">{p.email}</p>
                <p className="truncate text-[11px] text-muted">
                  {[p.participantId, p.programme, p.entryYear === null ? null : `${p.entryYear} entry`]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              {p.house && <StatusBadge tone="neutral">{p.house}</StatusBadge>}
              {p.teamId && (
                <StatusBadge tone="info">
                  {p.teamId} · {p.teamRole}
                </StatusBadge>
              )}
            </div>

            {isReachablePhone(p.phone) && (
              <a
                href={`tel:${p.phone}`}
                className="inline-flex items-center gap-1 text-xs font-medium text-brand underline"
              >
                <Phone size={11} strokeWidth={2.5} />
                {p.phone}
              </a>
            )}
          </Card>
        </li>
      ))}
    </ul>
  );
}
