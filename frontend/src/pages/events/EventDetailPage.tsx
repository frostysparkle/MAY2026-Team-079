import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { CalendarDays } from 'lucide-react';
import { api, ApiClientError } from '@/api';
import type { Event, MyEventRegistration } from '@/api/types';
import { ROUTES } from '@/config/routes';
import { Button, ErrorState, ResultBanner, Skeleton, StatusBadge } from '@/components/ui';
import { FestivalScreen } from '@/components/layout/FestivalScreen';
import { EventDetailView } from '@/components/events/EventDetailView';
import { fullEventView } from '@/features/events/eventView';
import { EventRegistrationForm } from '@/features/events/EventRegistrationForm';

/**
 * An event as the participant sees it — the very same `EventDetailView` the public
 * brochure and `AdminEventDetailPage` render, so the page an admin reviews, the
 * page a visitor reads, and the page a participant registers on are one design
 * with one implementation.
 *
 * This page used to hand-roll its own hero, meta grid, rounds list, prize list and
 * registration form. All five now come from the shared view, and what is left here
 * is the part that is genuinely specific to being signed in: registering,
 * cancelling, and the banner saying which of those applies.
 *
 * Uses `fullEventView` rather than the public normaliser: a participant may hold a
 * registration for an `event_type: 'others'` event, which has no public category,
 * and that must still open.
 */
export default function EventDetailPage() {
  const { eventId = '' } = useParams();
  const navigate = useNavigate();
  const [event, setEvent] = useState<Event | null>(null);
  const [registration, setRegistration] = useState<MyEventRegistration | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Clearing the error on success rather than up front keeps this free of a
  // synchronous setState when it runs as the mount effect.
  function load() {
    Promise.all([api.listEvents(), api.myEventRegistrations()])
      .then(([events, registrations]) => {
        const found = events.find((e) => e.event_id === eventId);
        if (!found) {
          setLoadError('That event no longer exists.');
          return;
        }
        setEvent(found);
        setRegistration(registrations.find((r) => r.event_id === eventId) ?? null);
        setLoadError(null);
      })
      .catch((e) =>
        setLoadError(e instanceof ApiClientError ? e.message : 'Could not load the event.'),
      );
  }
  useEffect(load, [eventId]);

  async function cancel() {
    setActionError(null);
    setBusy(true);
    try {
      await api.cancelEventRegistration(eventId);
      load();
    } catch (e) {
      setActionError(
        e instanceof ApiClientError ? e.message : 'Could not cancel your registration.',
      );
    } finally {
      setBusy(false);
    }
  }

  const backToEvents = { label: 'Events', onClick: () => navigate(ROUTES.events) };

  if (loadError) {
    return (
      <FestivalScreen title="Event" eyebrow="Programme" back={backToEvents}>
        <ErrorState title="Could not load event" description={loadError} onRetry={load} />
      </FestivalScreen>
    );
  }

  if (!event) {
    return (
      <FestivalScreen title="Event" eyebrow="Programme" back={backToEvents}>
        <Skeleton className="h-96" />
      </FestivalScreen>
    );
  }

  const view = fullEventView(event);

  return (
    <FestivalScreen
      title={view.category.label}
      eyebrow="Programme"
      subtitle={event.open ? 'Registration is open' : 'Registration is closed'}
      back={backToEvents}
      actions={
        <Button variant="secondary" onClick={() => navigate(ROUTES.schedule)} className="gap-1.5">
          <CalendarDays size={14} /> Fest schedule
        </Button>
      }
    >
      {actionError && (
        <ResultBanner variant="error" title="Action failed">
          {actionError}
        </ResultBanner>
      )}

      {!event.open && !registration && (
        <div>
          <StatusBadge tone="neutral">Closed for registration</StatusBadge>
        </div>
      )}

      <EventDetailView
        view={view}
        action={
          registration ? (
            <div className="flex flex-col gap-3">
              <ResultBanner variant="success" title="You're registered">
                {registration.team_id
                  ? `Team ${registration.team_id} · ${registration.team_role}`
                  : 'Solo entry'}
              </ResultBanner>
              {event.open ? (
                <Button variant="danger" loading={busy} onClick={cancel} className="w-fit">
                  Cancel registration
                </Button>
              ) : (
                <p className="text-sm text-muted">
                  Registration has closed, so this can no longer be edited or cancelled.
                </p>
              )}
            </div>
          ) : (
            // Handles the closed case, the team rule, and the admin-configured
            // fields — the same form the public event page submits.
            <EventRegistrationForm event={event} onRegistered={load} />
          )
        }
      />
    </FestivalScreen>
  );
}
