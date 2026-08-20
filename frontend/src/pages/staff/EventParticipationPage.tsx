import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { DoorOpen, Download, ScanLine, Ticket, Users } from 'lucide-react';
import { api, ApiClientError } from '@/api';
import type { Event, EventParticipationResponse } from '@/api/types';
import { path, ROUTES } from '@/config/routes';
import { isUhc, uhcHouse } from '@/stores/authStore';
import { toCsv, downloadCsv } from '@/lib/csv';
import { ADMITTED_NOTE, readEventCapacity } from '@/features/events/eventCapacity';
import { readEventExtras } from '@/features/events/eventExtras';
import {
  Avatar,
  Button,
  Card,
  EmptyState,
  ErrorState,
  ProgressBar,
  ResultBanner,
  Spinner,
  StatCard,
  StatusBadge,
} from '@/components/ui';
import { FestivalScreen } from '@/components/layout/FestivalScreen';

/**
 * Who has registered for an event, in the festival theme the rest of the event
 * screens use.
 *
 * Reached from the Super Admin dashboard's "⋮ → View participants" and from the
 * staff dashboard. Visibility is scoped server-side: a UHC member only sees
 * their own house, so a short list is not necessarily an error — hence the
 * house-detection warning below.
 *
 * Story 3.2 lives at the top of this screen: the organiser's answer to "how many
 * entries are left today", derived in `features/events/eventCapacity`. It is
 * shown only for events whose organiser has published a capacity.
 */
export default function EventParticipationPage() {
  const { eventId = '' } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState<EventParticipationResponse | null>(null);
  const [event, setEvent] = useState<Event | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .eventParticipation(eventId)
      .then(setData)
      .catch((e) =>
        setError(e instanceof ApiClientError ? e.message : 'Could not load participation.'),
      );

    // For the event's name in the title and its published capacity — never block
    // the page on it.
    api
      .listEvents()
      .then((events) => setEvent(events.find((e) => e.event_id === eventId) ?? null))
      .catch(() => undefined);
  }, [eventId]);

  // Reached from both the admin grid and the staff dashboard, so go back to
  // wherever the user actually came from.
  const back = { label: 'Back', onClick: () => navigate(-1) };

  if (error) {
    return (
      <FestivalScreen title="Participants" back={back}>
        <ErrorState title="Could not load participation" description={error} />
      </FestivalScreen>
    );
  }

  if (!data) {
    return (
      <FestivalScreen title="Participants" back={back}>
        <div className="flex h-64 items-center justify-center">
          <Spinner label="Loading" />
        </div>
      </FestivalScreen>
    );
  }

  const houseWarning = isUhc() && uhcHouse() === null;

  // Absent for UHC callers, so narrow rather than assert. `total_daily_scans`
  // counts distinct participants, not scan rows, so it needs no correction here.
  const attendedToday = typeof data.total_daily_scans === 'number' ? data.total_daily_scans : null;
  const capacity = readEventCapacity(
    event ? readEventExtras(event.registration).capacity : undefined,
    attendedToday,
  );

  // Registrations against the same published limit — a different question from
  // "who has walked in", and the one that tells an organiser they have sold more
  // places than the venue holds.
  const oversubscribed = capacity ? Math.max(0, data.count - capacity.capacity) : 0;

  return (
    <FestivalScreen
      title="Participants"
      eyebrow={event?.name ?? 'Event'}
      subtitle={`${data.count} registered${
        'total_daily_scans' in data ? ` · ${data.total_daily_scans} daily scans` : ''
      }`}
      back={back}
      actions={
        <>
          <Button
            variant="secondary"
            className="gap-1.5"
            disabled={data.participants.length === 0}
            onClick={() =>
              downloadCsv(
                `event-${eventId}-participation.csv`,
                toCsv(data.participants, [
                  'participant_id',
                  'name',
                  'email',
                  'phone',
                  'house',
                  'team_id',
                  'team_role',
                ]),
              )
            }
          >
            <Download size={14} /> Export CSV
          </Button>
          <Button
            variant="ghost"
            className="gap-1.5"
            onClick={() => navigate(path(ROUTES.scanEvent, { eventId }))}
          >
            <ScanLine size={14} /> Scan attendance
          </Button>
        </>
      }
    >
      {houseWarning && (
        <ResultBanner variant="warning" title="No house detected on your account">
          UHC visibility is derived from your email (e.g. wayanad-sec@...). Your email has no
          hyphen, so this list may show nobody even if participants exist.
        </ResultBanner>
      )}

      {capacity && (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-black uppercase tracking-[0.12em] text-ink">
            Entry capacity today
          </h2>
          <div className="grid gap-3 sm:grid-cols-3">
            <StatCard
              icon={Ticket}
              label="Published capacity"
              value={capacity.capacity.toLocaleString()}
              tone="brand"
              footnote={
                oversubscribed > 0
                  ? `${oversubscribed.toLocaleString()} more registered than the venue holds`
                  : `${data.count.toLocaleString()} registered`
              }
            />
            <StatCard
              icon={DoorOpen}
              label="Admitted today"
              value={capacity.admitted === null ? '—' : capacity.admitted.toLocaleString()}
              tone={capacity.atCapacity ? 'warning' : 'info'}
              footnote={
                capacity.admitted === null
                  ? 'Today’s attendance is not readable from this account'
                  : ADMITTED_NOTE
              }
            />
            <StatCard
              icon={Users}
              label="Entries left"
              value={capacity.remaining === null ? '—' : capacity.remaining.toLocaleString()}
              tone={capacity.atCapacity ? 'warning' : 'success'}
              footnote={
                capacity.admitted === null ? (
                  capacity.summary
                ) : (
                  <span className="flex flex-col gap-1">
                    <ProgressBar
                      value={capacity.admitted}
                      max={capacity.capacity}
                      tone={capacity.barTone}
                      label={`${event?.name ?? 'Event'} entries used`}
                    />
                    <span>{capacity.summary}</span>
                  </span>
                )
              }
            />
          </div>
          {capacity.over > 0 && (
            <ResultBanner
              variant="warning"
              title={`${capacity.over.toLocaleString()} past the published capacity`}
            >
              More people have been scanned in today than the published limit. The capacity is an
              organiser’s figure, not an enforced cap — the gate does not refuse anyone.
            </ResultBanner>
          )}
        </section>
      )}

      {data.event_team.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-black uppercase tracking-[0.12em] text-ink">Event team</h2>
          <div className="flex flex-wrap gap-2">
            {data.event_team.map((member) => (
              <span
                key={member.user_id}
                className="inline-flex items-center gap-2 rounded-full bg-surface px-3 py-1.5 text-sm font-semibold text-ink shadow-card ring-1 ring-line"
              >
                {member.name || member.user_id}
                <StatusBadge tone="info">{member.role.replace(/_/g, ' ')}</StatusBadge>
              </span>
            ))}
          </div>
        </section>
      )}

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-black uppercase tracking-[0.12em] text-ink">
          Registered ({data.count})
        </h2>

        {data.participants.length === 0 ? (
          <EmptyState
            title="Nobody has registered yet"
            description="Registrations appear here as soon as participants sign up."
            icon={Users}
          />
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {data.participants.map((p) => (
              <li key={p.participant_id}>
                <Card className="flex items-center gap-3">
                  <Avatar name={p.name ?? p.email} size={36} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold text-ink">{p.name || p.participant_id}</p>
                    <p className="truncate text-xs text-muted">{p.email}</p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    {p.house && <StatusBadge tone="neutral">{p.house}</StatusBadge>}
                    {p.team_id && (
                      <span className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                        {p.team_id} · {p.team_role}
                      </span>
                    )}
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>
    </FestivalScreen>
  );
}
