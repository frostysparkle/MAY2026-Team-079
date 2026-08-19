import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CalendarDays, Ticket } from 'lucide-react';
import { api, ApiClientError } from '@/api';
import type { Event, MyEventRegistration } from '@/api/types';
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
import {
  PUBLIC_EVENT_CATEGORIES,
  type PublicEventCategorySlug,
} from '@/features/events/publicEvents';
import { categorySlugForEventType, UNLISTED_CATEGORY } from '@/features/events/eventView';
import { EVENT_GRID_CLASS, EventPosterCard } from '@/features/events/EventPosterCard';

/**
 * The in-app event catalogue, dressed as the festival programme — the same poster
 * grid, grouped into the same categories, that `AdminEventsPage` and the public
 * brochure use.
 *
 * It is the same component tree as the admin dashboard's on purpose: an event
 * looks the same to the participant registering for it as it does to the admin who
 * published it. What differs is the layer on top — a "Registered" pill instead of
 * a "⋮" menu, and a card that opens the registration page rather than the editor.
 */

/** A category heading plus the events filed under it. */
interface Section {
  key: string;
  label: string;
  accent: string;
  /** Fallback artwork for events with no poster of their own. */
  image: string;
  slug?: PublicEventCategorySlug;
  events: Event[];
}

export default function EventsListPage() {
  const navigate = useNavigate();
  const [events, setEvents] = useState<Event[] | null>(null);
  const [registrations, setRegistrations] = useState<MyEventRegistration[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Clearing the error on success rather than up front keeps this free of a
  // synchronous setState when it runs as the mount effect.
  function load() {
    Promise.all([api.listEvents(), api.myEventRegistrations()])
      .then(([all, mine]) => {
        setEvents(all);
        setRegistrations(mine);
        setLoadError(null);
      })
      .catch((e) =>
        setLoadError(e instanceof ApiClientError ? e.message : 'Could not load events.'),
      );
  }
  useEffect(load, []);

  const registeredIds = useMemo(
    () => new Set(registrations.map((r) => r.event_id)),
    [registrations],
  );

  // Group into the three public categories, then anything unlisted.
  const sections = useMemo<Section[]>(() => {
    if (!events) return [];

    const grouped: Section[] = PUBLIC_EVENT_CATEGORIES.map((category) => ({
      key: category.slug,
      label: category.label,
      accent: category.accent,
      image: category.image,
      slug: category.slug,
      events: events.filter((e) => categorySlugForEventType(e.event_type) === category.slug),
    }));

    // `others` has no public category page, but a participant registered for one
    // still needs a way in, so it is framed as unlisted rather than dropped.
    const unlisted = events.filter((e) => categorySlugForEventType(e.event_type) === null);
    if (unlisted.length > 0) {
      grouped.push({
        key: 'unlisted',
        label: UNLISTED_CATEGORY.label,
        accent: UNLISTED_CATEGORY.accent,
        image: UNLISTED_CATEGORY.image,
        events: unlisted,
      });
    }

    return grouped.filter((section) => section.events.length > 0);
  }, [events]);

  if (loadError) {
    return <ErrorState title="Could not load events" description={loadError} onRetry={load} />;
  }

  const openCount = events?.filter((e) => e.open).length ?? 0;

  return (
    <FestivalScreen
      title="Events"
      eyebrow="Programme"
      subtitle={
        events === null
          ? 'Loading the programme…'
          : `${events.length} event${events.length === 1 ? '' : 's'} · ${openCount} open for registration`
      }
      actions={
        <>
          <Button onClick={() => navigate(ROUTES.myRegistrations)} className="gap-1.5">
            <Ticket size={15} strokeWidth={2.5} /> My registrations
          </Button>
          <Button variant="secondary" onClick={() => navigate(ROUTES.schedule)} className="gap-1.5">
            <CalendarDays size={14} /> Schedule
          </Button>
        </>
      }
    >
      {events === null ? (
        <ul className={EVENT_GRID_CLASS} aria-busy="true">
          {Array.from({ length: 8 }, (_, i) => (
            <li key={i} className="flex flex-col gap-2">
              <Skeleton className="aspect-[4/5] w-full rounded-2xl" />
              <Skeleton className="h-4 w-3/4" />
            </li>
          ))}
        </ul>
      ) : events.length === 0 ? (
        <EmptyState
          title="No events yet"
          description="The programme appears here as soon as the organisers publish it."
          icon={Ticket}
        />
      ) : (
        sections.map((section) => (
          <section key={section.key} className="flex flex-col gap-4">
            <SectionHeading
              title={section.label}
              accentColor={section.accent}
              meta={`${section.events.length} event${section.events.length === 1 ? '' : 's'}`}
            />

            <ul className={EVENT_GRID_CLASS}>
              {section.events.map((event) => (
                <EventPosterCard
                  key={event.event_id}
                  to={path(ROUTES.eventDetail, { eventId: event.event_id })}
                  name={event.name}
                  poster={event.poster}
                  fallbackImage={section.image}
                  meta={metaFor(event)}
                  badge={
                    registeredIds.has(event.event_id) ? (
                      <StatusBadge tone="success" className="shadow-card ring-1 ring-line">
                        Registered
                      </StatusBadge>
                    ) : (
                      !event.open && (
                        <StatusBadge tone="neutral" className="shadow-card ring-1 ring-line">
                          Closed
                        </StatusBadge>
                      )
                    )
                  }
                />
              ))}
            </ul>
          </section>
        ))
      )}
    </FestivalScreen>
  );
}

/**
 * The line under a poster. Team size and round count, because those are what
 * decide whether a participant can enter at all — where the admin grid shows
 * prize and round counts, which is what it is there to manage.
 */
function metaFor(event: Event): string {
  const { min = 1, max = 1 } = event.team ?? {};
  const team = max <= 1 ? 'Solo' : min === max ? `Team of ${max}` : `Team of ${min}–${max}`;
  const rounds = event.schedule?.length ?? 0;
  return [team, rounds > 0 && `${rounds} round${rounds === 1 ? '' : 's'}`]
    .filter(Boolean)
    .join(' · ');
}
