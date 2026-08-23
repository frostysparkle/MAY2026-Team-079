import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CalendarDays, Sparkles, Ticket } from 'lucide-react';
import { api, ApiClientError } from '@/api';
import type { Event, MyEventRegistration, RecommendedEvent } from '@/api/types';
import { path, ROUTES } from '@/config/routes';
import {
  Button,
  BUTTON_ICON,
  BUTTON_ICON_STROKE,
  EmptyState,
  ErrorState,
  SectionBlock,
  StatusBadge,
} from '@/components/ui';
import { FestivalScreen } from '@/components/layout/FestivalScreen';
import {
  PUBLIC_EVENT_CATEGORIES,
  type PublicEventCategorySlug,
} from '@/features/events/publicEvents';
import { categorySlugForEventType, UNLISTED_CATEGORY } from '@/features/events/eventView';
import {
  EVENT_GRID_CLASS,
  EventGridSkeleton,
  EventPosterCard,
} from '@/features/events/EventPosterCard';
import { AiRecommendBar } from '@/features/ai/AiRecommendBar';

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

/**
 * How many of the top-ranked cards carry the "Suggested" badge when an AI
 * ranking is active. The backend already returns every event sorted most
 * similar first, so this is purely a display cutoff — cards ranked 6th or
 * lower stay in the list (nothing is hidden), they just lose the badge.
 */
const TOP_RECOMMENDED_COUNT = 5;

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

  // The AI-ranked view, when active: every event the plain list already has,
  // just carrying a `similarity` score and sorted by it. `null` means the
  // banner has never been used (or has been cleared) — render the normal
  // category-grouped grid instead.
  const [recommended, setRecommended] = useState<RecommendedEvent[] | null>(null);
  const [recommendLoading, setRecommendLoading] = useState(false);
  const [recommendError, setRecommendError] = useState<string | null>(null);

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

  function handleRecommend(query: string) {
    setRecommendLoading(true);
    setRecommendError(null);
    api
      .recommendEvents({ query: query || null })
      .then((ranked) => setRecommended(ranked))
      .catch((e) =>
        setRecommendError(
          e instanceof ApiClientError ? e.message : 'Could not get recommendations.',
        ),
      )
      .finally(() => setRecommendLoading(false));
  }

  function clearRecommendations() {
    setRecommended(null);
    setRecommendError(null);
  }

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

  // Inside the screen, not instead of it. Returned bare, an `ErrorState` renders
  // with no page column at all: no title, no eyebrow, no `max-w-7xl` centring and
  // no horizontal padding, so a failed fetch dropped the participant onto a
  // full-bleed message that did not look like part of the app — and gave them no
  // indication of which section had failed. `MyRegistrationsPage` and
  // `EventDetailPage` already wrapped theirs; the three list screens did not.
  if (loadError) {
    return (
      <FestivalScreen title="Events" eyebrow="Programme">
        <ErrorState title="Could not load events" description={loadError} onRetry={load} />
      </FestivalScreen>
    );
  }

  const openCount = events?.filter((e) => e.registration.is_open).length ?? 0;

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
          <Button onClick={() => navigate(ROUTES.myRegistrations)}>
            <Ticket size={BUTTON_ICON.md} strokeWidth={BUTTON_ICON_STROKE} /> My registrations
          </Button>
          <Button variant="secondary" onClick={() => navigate(ROUTES.schedule)}>
            <CalendarDays size={BUTTON_ICON.md} strokeWidth={BUTTON_ICON_STROKE} /> Schedule
          </Button>
        </>
      }
    >
      {events !== null && events.length > 0 && (
        <AiRecommendBar
          noun="events"
          placeholder="e.g. dance, coding, quizzes…"
          active={recommended !== null}
          loading={recommendLoading}
          onSearch={handleRecommend}
          onClear={clearRecommendations}
          // `POST /events/recommendations` is not implemented on the backend
          // (405 Method Not Allowed) — see `AiRecommendBar`'s `available` prop.
          // Disabled rather than left to fail silently on first tap.
          available={false}
        />
      )}

      {recommendError && (
        <ErrorState
          title="Could not get recommendations"
          description={recommendError}
          onRetry={() => handleRecommend('')}
        />
      )}

      {events === null ? (
        <EventGridSkeleton />
      ) : events.length === 0 ? (
        <EmptyState
          title="No events yet"
          description="The programme appears here as soon as the organisers publish it."
          icon={Ticket}
        />
      ) : recommended !== null ? (
        <SectionBlock
          title="Recommended for you"
          meta={`${recommended.length} event${recommended.length === 1 ? '' : 's'} · ranked by match`}
        >
          <ul className={EVENT_GRID_CLASS}>
            {recommended.map((event, index) => (
              <EventPosterCard
                key={event.event_id}
                to={path(ROUTES.eventDetail, { eventId: event.event_id })}
                name={event.name}
                poster={event.poster}
                fallbackImage={
                  PUBLIC_EVENT_CATEGORIES.find(
                    (c) => c.slug === categorySlugForEventType(event.event_type),
                  )?.image ?? UNLISTED_CATEGORY.image
                }
                meta={metaFor(event)}
                badge={
                  <span className="flex flex-wrap items-center gap-1.5">
                    {/* Backend already sorts by similarity, most similar first,
                        so the top 5 by array position are the top 5 by score. */}
                    {index < TOP_RECOMMENDED_COUNT && (
                      <StatusBadge tone="info" className="shadow-card ring-1 ring-line">
                        <Sparkles size={11} strokeWidth={2.5} className="mr-1 inline" />
                        Suggested
                      </StatusBadge>
                    )}
                    {registeredIds.has(event.event_id) && (
                      <StatusBadge tone="success" className="shadow-card ring-1 ring-line">
                        Registered
                      </StatusBadge>
                    )}
                    {!event.registration.is_open && (
                      <StatusBadge tone="neutral" className="shadow-card ring-1 ring-line">
                        Registration Closed
                      </StatusBadge>
                    )}
                  </span>
                }
              />
            ))}
          </ul>
        </SectionBlock>
      ) : (
        sections.map((section) => (
          <SectionBlock
            key={section.key}
            title={section.label}
            accentColor={section.accent}
            meta={`${section.events.length} event${section.events.length === 1 ? '' : 's'}`}
          >
            <ul className={EVENT_GRID_CLASS}>
              {section.events.map((event) => (
                <EventPosterCard
                  key={event.event_id}
                  to={path(ROUTES.eventDetail, { eventId: event.event_id })}
                  name={event.name}
                  poster={event.poster}
                  fallbackImage={section.image}
                  meta={metaFor(event)}
                  // Both facts when both apply. The ternary this replaces hid the
                  // closed state from anybody already registered, so the one
                  // person who most needs to know that entries are shut — because
                  // it is also when they can no longer cancel — was the one told
                  // nothing. "Registration Closed" in full, as the guide words it.
                  badge={
                    <span className="flex flex-wrap items-center gap-1.5">
                      {registeredIds.has(event.event_id) && (
                        <StatusBadge tone="success" className="shadow-card ring-1 ring-line">
                          Registered
                        </StatusBadge>
                      )}
                      {!event.registration.is_open && (
                        <StatusBadge tone="neutral" className="shadow-card ring-1 ring-line">
                          Registration Closed
                        </StatusBadge>
                      )}
                    </span>
                  }
                />
              ))}
            </ul>
          </SectionBlock>
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
