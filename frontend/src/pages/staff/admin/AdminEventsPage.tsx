import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Ticket } from 'lucide-react';
import { api, ApiClientError } from '@/api';
import type { Event } from '@/api/types';
import { path, ROUTES } from '@/config/routes';
import {
  ActionMenu,
  Button,
  EmptyState,
  ErrorState,
  ResultBanner,
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
import { useAdminEventActions } from '@/features/events/adminEventActions';

/**
 * Super Admin event dashboard, dressed as the festival programme.
 *
 * It shows the same poster grid the public catalogue does — same component, same
 * artwork — because an admin should see what visitors see. The management layer
 * sits on top of it rather than replacing it: a status pill for registration, a
 * "⋮" menu per card, and the card itself opening the event page.
 *
 * Authoring stays in `AdminEventEditorPage`, which covers the full event shape.
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

export default function AdminEventsPage() {
  const navigate = useNavigate();
  const [events, setEvents] = useState<Event[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Clearing the error on success rather than up front keeps this free of a
  // synchronous setState when it runs as the mount effect.
  function load() {
    api
      .listEvents()
      .then((all) => {
        setEvents(all);
        setLoadError(null);
      })
      .catch((e) =>
        setLoadError(e instanceof ApiClientError ? e.message : 'Could not load events.'),
      );
  }
  useEffect(load, []);

  const actions = useAdminEventActions({ onChanged: load, onDeleted: load });

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

    // `others` has no public category page, but an admin still has to manage it.
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
      subtitle={
        events === null
          ? 'Loading the programme…'
          : `${events.length} event${events.length === 1 ? '' : 's'} · ${openCount} open for registration`
      }
      actions={
        <Button onClick={() => navigate(ROUTES.adminEventNew)} className="gap-1.5">
          <Plus size={15} strokeWidth={2.5} /> New event
        </Button>
      }
    >
      {actions.error && (
        <ResultBanner variant="error" title="Action failed">
          {actions.error}
        </ResultBanner>
      )}

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
          description="Create one and it appears here and in the public catalogue."
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
                  to={path(ROUTES.adminEventDetail, { eventId: event.event_id })}
                  name={event.name}
                  poster={event.poster}
                  fallbackImage={section.image}
                  meta={`${event.schedule.length} round${event.schedule.length === 1 ? '' : 's'} · ${event.prize_money.length} prize${event.prize_money.length === 1 ? '' : 's'}`}
                  badge={
                    !event.open && (
                      <StatusBadge tone="neutral" className="shadow-card ring-1 ring-line">
                        Closed
                      </StatusBadge>
                    )
                  }
                  overlay={
                    <ActionMenu
                      label={`Actions for ${event.name}`}
                      items={actions.itemsFor(event)}
                    />
                  }
                />
              ))}
            </ul>
          </section>
        ))
      )}

      {actions.dialog}
    </FestivalScreen>
  );
}
