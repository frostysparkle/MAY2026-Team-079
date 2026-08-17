import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Ticket } from 'lucide-react';
import { api, ApiClientError } from '@/api';
import type { Event, MyEventRegistration, MyWorkshopRegistration } from '@/api/types';
import { parseSlotId, shiftLabel, workshopDayLabel } from '@/features/workshops/workshopSlot';
import { WORKSHOP_COVER, workshopPosterPaths } from '@/features/workshops/workshopView';
import { path, ROUTES } from '@/config/routes';
import {
  Button,
  EmptyState,
  ErrorState,
  SectionHeading,
  Skeleton,
  StatusBadge,
} from '@/components/ui';
import { FestivalScreen } from '@/components/layout/FestivalScreen';
import { fullEventView } from '@/features/events/eventView';
import { EVENT_GRID_CLASS, EventPosterCard } from '@/features/events/EventPosterCard';

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

  // Clearing the error on success rather than up front keeps this free of a
  // synchronous setState when it runs as the mount effect.
  function load() {
    Promise.all([api.myEventRegistrations(), api.listEvents(), api.myWorkshopRegistrations()])
      .then(([mine, all, mineWorkshops]) => {
        setRegistrations(mine);
        setEvents(all);
        setWorkshops(mineWorkshops);
        setLoadError(null);
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

  const open = entries.filter((entry) => entry.event.open);
  const closed = entries.filter((entry) => !entry.event.open);

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
      {registrations === null ? (
        <ul className={EVENT_GRID_CLASS} aria-busy="true">
          {Array.from({ length: 4 }, (_, i) => (
            <li key={i} className="flex flex-col gap-2">
              <Skeleton className="aspect-[4/5] w-full rounded-2xl" />
              <Skeleton className="h-4 w-3/4" />
            </li>
          ))}
        </ul>
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
    <section className="flex flex-col gap-4">
      <SectionHeading
        title={title}
        meta={`${entries.length} event${entries.length === 1 ? '' : 's'}`}
      />

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
              badge={
                <StatusBadge
                  tone={event.open ? 'success' : 'neutral'}
                  className="shadow-card ring-1 ring-line"
                >
                  {event.open ? 'Registered' : 'Closed'}
                </StatusBadge>
              }
            />
          );
        })}
      </ul>
    </section>
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
    <section className="flex flex-col gap-4">
      <SectionHeading
        title="Workshops"
        meta={`${registrations.length} workshop${registrations.length === 1 ? '' : 's'}`}
      />

      <ul className={EVENT_GRID_CLASS}>
        {registrations.map((registration) => {
          const slot = parseSlotId(registration.slot_id);
          const when = slot.date
            ? `${workshopDayLabel(slot.date)}${slot.shift ? ` · ${shiftLabel(slot.shift)}` : ''}`
            : 'Slot to be announced';

          // A workshop deleted after booking keeps its slot but has no id to
          // link to and no name to show; it still belongs on this list.
          if (!registration.workshop_id) {
            return (
              <li
                key={registration.slot_id}
                className="flex flex-col gap-2 rounded-2xl bg-surface p-4 shadow-card ring-1 ring-line"
              >
                <p className="font-semibold text-ink">Workshop no longer available</p>
                <p className="text-xs text-muted">{when}</p>
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
    </section>
  );
}
