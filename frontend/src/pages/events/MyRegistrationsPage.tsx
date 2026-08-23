import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CalendarX2, Ticket } from 'lucide-react';
import { api, ApiClientError } from '@/api';
import type { Event, MyEventRegistration, MyWorkshopRegistration } from '@/api/types';
import { parseSlotId, shiftLabel, workshopDayLabel } from '@/features/workshops/workshopSlot';
import { WORKSHOP_COVER, workshopPosterPaths } from '@/features/workshops/workshopView';
import { path, ROUTES } from '@/config/routes';
import { Button, EmptyState, ErrorState, SectionBlock, StatusBadge } from '@/components/ui';
import { FestivalScreen } from '@/components/layout/FestivalScreen';
import { fullEventView } from '@/features/events/eventView';
import {
  EVENT_GRID_CLASS,
  EventGridSkeleton,
  EventPosterCard,
} from '@/features/events/EventPosterCard';
import { EventChangeAlerts } from '@/features/events/EventChangeAlerts';
import {
  dismissAllEventChanges,
  dismissEventChange,
  syncEventChanges,
  type EventChange,
} from '@/features/events/eventChanges';
import { currentParticipant } from '@/stores/authStore';

/**
 * Everything this participant is registered for, as the same poster grid the
 * catalogue and the admin dashboard use — so a registration is recognisably the
 * same event tile the participant clicked to get it, not a different-looking list
 * row.
 *
 * Split into open and closed, because that is the distinction that matters once
 * you already hold the registration: an open event can still be cancelled.
 */

/** A registration paired with the event record it points at. */
interface Entry {
  registration: MyEventRegistration;
  event: Event;
}

export default function MyRegistrationsPage() {
  const navigate = useNavigate();
  const [registrations, setRegistrations] = useState<MyEventRegistration[] | null>(null);
  const [events, setEvents] = useState<Event[]>([]);
  const [workshops, setWorkshops] = useState<MyWorkshopRegistration[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [changes, setChanges] = useState<EventChange[]>([]);

  const participantId = currentParticipant()?.id ?? '';

  // Clearing the error on success rather than up front keeps this free of a
  // synchronous setState when it runs as the mount effect.
  function load() {
    Promise.all([api.myEventRegistrations(), api.listEvents(), api.myWorkshopRegistrations()])
      .then(([mine, all, mineWorkshops]) => {
        setRegistrations(mine);
        setEvents(all);
        setWorkshops(mineWorkshops);
        setLoadError(null);
        // Story 1.2. Shares the dismissal record with the dashboard, so an alert
        // dismissed on either screen is gone from both. The id is read here
        // rather than closed over so this stays a mount-only effect.
        setChanges(syncEventChanges(currentParticipant()?.id ?? '', all, mine));
      })
      .catch((e) =>
        setLoadError(e instanceof ApiClientError ? e.message : 'Could not load registrations.'),
      );
  }
  useEffect(load, []);

  const entries = useMemo<Entry[]>(() => {
    if (!registrations) return [];
    return registrations.flatMap((registration) => {
      const event = events.find((e) => e.event_id === registration.event_id);
      // A registration whose event has since been deleted has nothing to show and
      // nowhere to link; the count in the subtitle still reflects it.
      return event ? [{ registration, event }] : [];
    });
  }, [registrations, events]);

  const open = entries.filter((entry) => entry.event.registration.is_open);
  const closed = entries.filter((entry) => !entry.event.registration.is_open);

  // Chronological, so the workshop grid reads as an itinerary: by day, then
  // morning before afternoon. Undated bookings sort last rather than first.
  const bookedWorkshops = useMemo(
    () =>
      [...workshops].sort((a, b) => {
        const slotA = parseSlotId(a.slot_id);
        const slotB = parseSlotId(b.slot_id);
        const dayA = slotA.date ?? '￿';
        const dayB = slotB.date ?? '￿';
        if (dayA !== dayB) return dayA.localeCompare(dayB);
        const rank = (s?: string) => (s === 'morning' ? 0 : s === 'afternoon' ? 1 : 2);
        return rank(slotA.shift) - rank(slotB.shift);
      }),
    [workshops],
  );

  const total = (registrations?.length ?? 0) + workshops.length;

  const backToEvents = { label: 'Events', onClick: () => navigate(ROUTES.events) };

  if (loadError) {
    return (
      <FestivalScreen title="My Registrations" eyebrow="Programme" back={backToEvents}>
        <ErrorState title="Could not load registrations" description={loadError} onRetry={load} />
      </FestivalScreen>
    );
  }

  return (
    <FestivalScreen
      title="My Registrations"
      eyebrow="Programme"
      subtitle={
        registrations === null
          ? 'Loading your registrations…'
          : `${total} registration${total === 1 ? '' : 's'} · ${open.length} event${open.length === 1 ? '' : 's'} still open · ${workshops.length} workshop${workshops.length === 1 ? '' : 's'}`
      }
      back={backToEvents}
    >
      <EventChangeAlerts
        changes={changes}
        onDismiss={(id) => setChanges(dismissEventChange(participantId, id))}
        onDismissAll={() => setChanges(dismissAllEventChanges(participantId))}
      />

      {registrations === null ? (
        <EventGridSkeleton count={4} />
      ) : entries.length === 0 && bookedWorkshops.length === 0 ? (
        <EmptyState
          title="No registrations yet"
          description="Browse the programme and register for anything that is still open."
          icon={Ticket}
          action={<Button onClick={() => navigate(ROUTES.events)}>Browse events</Button>}
        />
      ) : (
        <>
          <Group title="Open" entries={open} />
          <Group title="Closed" entries={closed} />
          <WorkshopGroup registrations={bookedWorkshops} />
        </>
      )}
    </FestivalScreen>
  );
}

/** One heading plus its grid of registered events. Renders nothing when empty. */
function Group({ title, entries }: { title: string; entries: Entry[] }) {
  if (entries.length === 0) return null;

  return (
    <SectionBlock title={title} meta={`${entries.length} event${entries.length === 1 ? '' : 's'}`}>
      <ul className={EVENT_GRID_CLASS}>
        {entries.map(({ registration, event }) => {
          const view = fullEventView(event);
          return (
            <EventPosterCard
              key={event.event_id}
              to={path(ROUTES.eventDetail, { eventId: event.event_id })}
              name={event.name}
              poster={event.poster}
              fallbackImage={view.category.image}
              meta={
                registration.team_id
                  ? `Team ${registration.team_id} · ${registration.team_role}`
                  : 'Solo entry'
              }
              // Every tile here *is* a registration, so "Registered" is the
              // constant and the closure is the news. Previously the two were
              // alternatives, which made a closed entry read as though the
              // registration had lapsed — and used wording the catalogue did not.
              badge={
                <span className="flex flex-wrap items-center gap-1.5">
                  <StatusBadge tone="success" className="shadow-card ring-1 ring-line">
                    Registered
                  </StatusBadge>
                  {!event.registration.is_open && (
                    <StatusBadge tone="neutral" className="shadow-card ring-1 ring-line">
                      Registration Closed
                    </StatusBadge>
                  )}
                </span>
              }
            />
          );
        })}
      </ul>
    </SectionBlock>
  );
}

/**
 * The workshops this participant has booked, as the same poster grid the events
 * use above — a booking is a booking, whichever programme it came from.
 *
 * Each tile names the day and shift it occupies, because that is the thing
 * that makes a workshop booking meaningful: only one is possible per shift, so
 * the grid doubles as a picture of which shifts are already spoken for.
 */
function WorkshopGroup({ registrations }: { registrations: MyWorkshopRegistration[] }) {
  if (registrations.length === 0) return null;

  return (
    <SectionBlock
      title="Workshops"
      meta={`${registrations.length} workshop${registrations.length === 1 ? '' : 's'}`}
    >
      <ul className={EVENT_GRID_CLASS}>
        {registrations.map((registration) => {
          const slot = parseSlotId(registration.slot_id);
          const when = slot.date
            ? `${workshopDayLabel(slot.date)}${slot.shift ? ` · ${shiftLabel(slot.shift)}` : ''}`
            : 'Slot to be announced';

          // A workshop deleted after booking keeps its slot but has no id to
          // link to and no name to show; it still belongs on this list.
          //
          // Shaped like the poster tiles it sits among rather than as a short text
          // card: this is a cell of a grid whose other cells are all a 4:5 tile
          // over a title and a meta line, and a card two lines tall dropped into
          // that row left the tiles beside it standing over a gap. The tile is a
          // muted placeholder, the title and meta line sit exactly where a
          // poster's do, and the row stays level.
          if (!registration.workshop_id) {
            return (
              <li key={registration.slot_id} className="flex flex-col">
                <div className="overflow-hidden rounded-2xl shadow-card ring-1 ring-line/70">
                  <div className="flex aspect-[4/5] w-full items-center justify-center rounded-2xl bg-surface-2">
                    <CalendarX2 size={40} strokeWidth={1.5} aria-hidden className="text-muted" />
                  </div>
                </div>
                <p className="mt-2.5 text-sm font-semibold leading-5 text-ink lg:text-base lg:leading-6">
                  Workshop no longer available
                </p>
                <p className="mt-0.5 text-xs font-medium text-muted lg:text-sm">{when}</p>
              </li>
            );
          }

          const { poster } = workshopPosterPaths(registration.workshop_id);
          return (
            <EventPosterCard
              key={registration.workshop_id}
              to={path(ROUTES.workshopDetail, { workshopId: registration.workshop_id })}
              name={registration.name ?? registration.workshop_id}
              poster={poster}
              fallbackImage={WORKSHOP_COVER}
              meta={when}
              badge={
                <StatusBadge
                  tone={registration.attended ? 'success' : 'neutral'}
                  className="shadow-card ring-1 ring-line"
                >
                  {registration.attended ? 'Attended' : 'Booked'}
                </StatusBadge>
              }
            />
          );
        })}
      </ul>
    </SectionBlock>
  );
}
