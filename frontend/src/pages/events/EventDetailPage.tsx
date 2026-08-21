import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { CalendarDays } from 'lucide-react';
import { api, ApiClientError } from '@/api';
import type { Event, MyEventRegistration } from '@/api/types';
import { readEventExtras } from '@/features/events/eventExtras';
import { ROUTES } from '@/config/routes';
import {
  Button,
  BUTTON_ICON,
  BUTTON_ICON_STROKE,
  ErrorState,
  ResultBanner,
  Skeleton,
} from '@/components/ui';
import { FestivalScreen } from '@/components/layout/FestivalScreen';
import { EventDetailView } from '@/components/events/EventDetailView';
import { fullEventView } from '@/features/events/eventView';
import { EventRegistrationForm } from '@/features/events/EventRegistrationForm';
import { EventCrowdCard } from '@/features/events/EventCrowdCard';
import { useEventCrowd } from '@/features/events/useEventCrowd';

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
 *
 * Story 3.3 sits between the meta tiles and the registration action: how busy the
 * event is right now, refreshed after the participant registers or cancels so the
 * count they are looking at includes what they just did.
 */
export default function EventDetailPage() {
  const { eventId = '' } = useParams();
  const navigate = useNavigate();
  const [event, setEvent] = useState<Event | null>(null);
  const [registration, setRegistration] = useState<MyEventRegistration | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // The published capacity is read from the event the page already holds, so the
  // parsing rule lives in one place — see `eventExtras.parseCapacity`.
  const capacity = event ? readEventExtras(event.registration).capacity : undefined;
  const { counts, reload: reloadCrowd } = useEventCrowd(eventId);

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

  /**
   * Re-read the event *and* the crowd counts.
   *
   * Used by the two actions that change what those counts say — registering and
   * cancelling — so the participant sees a figure that includes what they just
   * did. The mount read is not here: `useEventCrowd` does its own, and folding
   * it into `load` would make the mount effect depend on the hook's callback.
   */
  function refresh() {
    load();
    void reloadCrowd();
  }

  async function cancel() {
    setActionError(null);
    setBusy(true);
    try {
      await api.cancelEventRegistration(eventId);
      refresh();
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
        {/* `rounded-2xl`, so the placeholder has the corner of the panel that
            replaces it. `Skeleton` defaults to `rounded-lg`, which is the radius
            of an input, not of a card. */}
        <Skeleton className="h-96 rounded-2xl" />
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
        <Button variant="secondary" onClick={() => navigate(ROUTES.schedule)}>
          <CalendarDays size={BUTTON_ICON.md} strokeWidth={BUTTON_ICON_STROKE} /> Fest schedule
        </Button>
      }
    >
      {actionError && (
        <ResultBanner variant="error" title="Action failed">
          {actionError}
        </ResultBanner>
      )}

      {/* The loose "Closed for registration" pill that used to sit here is gone.
          It was a top-level block holding one badge, so it took a full 20px of the
          screen's gap above and below to say what the subtitle two lines up
          already says in words ("Registration is closed") — and the registration
          form below it says a third time. A stray chip on its own line is also the
          one thing on these screens that is neither a panel nor a banner, which is
          what made this page's rhythm read as broken. */}
      <EventDetailView
        view={view}
        crowd={counts && <EventCrowdCard counts={counts} capacity={capacity} />}
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
            <EventRegistrationForm event={event} onRegistered={refresh} />
          )
        }
      />
    </FestivalScreen>
  );
}
