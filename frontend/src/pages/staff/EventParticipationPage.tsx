import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Download, ScanLine, Users } from 'lucide-react';
import { api, ApiClientError } from '@/api';
import type { Event, EventParticipationResponse } from '@/api/types';
import { path, ROUTES } from '@/config/routes';
import { isUhc, uhcHouse } from '@/stores/authStore';
import { toCsv, downloadCsv } from '@/lib/csv';
import {
  Avatar,
  Button,
  Card,
  EmptyState,
  ErrorState,
  ResultBanner,
  Spinner,
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

    // Only for the event's name in the title — never block the page on it.
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
