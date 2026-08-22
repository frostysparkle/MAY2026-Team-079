import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '@/api';
import type { Event } from '@/api/types';
import {
  EventParticipationActions,
  EventParticipationView,
} from '@/features/events/EventParticipationView';
import { useEventParticipation } from '@/features/events/useEventParticipation';
import { ErrorState, Spinner } from '@/components/ui';
import { FestivalScreen } from '@/components/layout/FestivalScreen';

/**
 * Who has registered for an event, in the festival theme the rest of the event
 * screens use.
 *
 * Reached from the Super Admin dashboard's "⋮ → View participants", and from each
 * event's own screens. It is no longer the only way to this content: a staffer on
 * an event team now sees the same roster inline on their dashboard, which is why
 * the body lives in `EventParticipationView` and this file is the full-screen
 * framing around it — title, back affordance, actions, and the two states the
 * dashboard renders at section size instead.
 *
 * Visibility is scoped server-side: a UHC member only sees their own house, so a
 * short list is not necessarily an error — the view carries the warning that says
 * so.
 */
export default function EventParticipationPage() {
  const { eventId = '' } = useParams();
  const navigate = useNavigate();
  const { data, error } = useEventParticipation(eventId);
  const [event, setEvent] = useState<Event | null>(null);

  useEffect(() => {
    // For the event's name in the title and its published capacity — never block
    // the page on it.
    api
      .listEvents()
      .then((events) => setEvent(events.find((e) => e.event_id === eventId) ?? null))
      .catch(() => undefined);
  }, [eventId]);

  // Reached from both the admin grid and an event's own screens, so go back to
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

  return (
    <FestivalScreen
      title="Participants"
      eyebrow={event?.name ?? 'Event'}
      subtitle={`${data.count} registered${
        'total_daily_scans' in data ? ` · ${data.total_daily_scans} daily scans` : ''
      }`}
      back={back}
      actions={<EventParticipationActions eventId={eventId} event={event} data={data} />}
    >
      <EventParticipationView eventId={eventId} event={event} data={data} />
    </FestivalScreen>
  );
}
