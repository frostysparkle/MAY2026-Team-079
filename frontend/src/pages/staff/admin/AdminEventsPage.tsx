import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Ticket } from 'lucide-react';
import { api, ApiClientError } from '@/api';
import type { Event } from '@/api/types';
import { path, ROUTES } from '@/config/routes';
import {
  ActionMenu,
  ANY,
  Button,
  EmptyState,
  ErrorState,
  ListToolbar,
  ResultBanner,
  SectionHeading,
  Skeleton,
  StatusBadge,
  useListFilters,
  type FilterSpec,
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

/** Category key for an event the public catalogue has no home for. */
const UNLISTED_KEY = 'unlisted';

/** URL query keys. Kept short: they are user-visible in a shared link. */
const CATEGORY_KEY = 'category';
const STATUS_KEY = 'status';

/** The frame a category is dressed in: heading colour and fallback artwork. */
interface CategoryFrame {
  key: string;
  label: string;
  accent: string;
  /** Fallback artwork for events with no poster of their own. */
  image: string;
  slug?: PublicEventCategorySlug;
}

/**
 * Every category an event can be filed under, in programme order. The three
 * public ones first, then the unlisted bucket — which has no public category
 * page, but an admin still has to manage what is in it.
 */
const CATEGORY_FRAMES: CategoryFrame[] = [
  ...PUBLIC_EVENT_CATEGORIES.map((category) => ({
    key: category.slug,
    label: category.label,
    accent: category.accent,
    image: category.image,
    slug: category.slug,
  })),
  {
    key: UNLISTED_KEY,
    label: UNLISTED_CATEGORY.label,
    accent: UNLISTED_CATEGORY.accent,
    image: UNLISTED_CATEGORY.image,
  },
];

/**
 * Shown in the advanced row, where `ListToolbar` renders the label on screen —
 * hence a short noun and an "Any …" catch-all, matching Staffing on Hostels
 * rather than the "Filter by …" phrasing the sr-only inline labels use.
 */
const STATUS_SPEC: FilterSpec = {
  key: STATUS_KEY,
  label: 'Registration',
  anyLabel: 'Any registration',
  options: [
    { value: 'open', label: 'Open' },
    { value: 'closed', label: 'Closed' },
  ],
};

/** An event with the category it sits in and the text the search box matches. */
interface EventRow {
  event: Event;
  categoryKey: string;
  /** Lowercased haystack, joined once at load rather than per keystroke. */
  haystack: string;
}

/** A category heading plus the events filed under it. */
interface Section extends CategoryFrame {
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

  /* ----------------------------------------------------- filter / search --- */

  const rows = useMemo<EventRow[]>(() => {
    if (!events) return [];
    return events.map((event) => {
      const categoryKey = categorySlugForEventType(event.event_type) ?? UNLISTED_KEY;
      const frame = CATEGORY_FRAMES.find((f) => f.key === categoryKey);
      return {
        event,
        categoryKey,
        // Rounds and venues are in here because "where is the quiz final" is a
        // question an admin actually asks of this screen, and the round is the
        // only thing that carries a venue.
        haystack: [
          event.name,
          event.event_id,
          event.event_type,
          frame?.label,
          ...event.schedule.flatMap((round) => [round.name, round.venue]),
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase(),
      };
    });
  }, [events]);

  // Options are derived from the events themselves, so the filter can only offer
  // a category something is actually filed under.
  const categorySpec = useMemo<FilterSpec>(
    () => ({
      key: CATEGORY_KEY,
      label: 'Filter by category',
      anyLabel: 'All categories',
      options: CATEGORY_FRAMES.filter((frame) =>
        rows.some((row) => row.categoryKey === frame.key),
      ).map((frame) => ({ value: frame.key, label: frame.label })),
    }),
    [rows],
  );

  const allSpecs = useMemo(() => [categorySpec, STATUS_SPEC], [categorySpec]);
  const filters = useListFilters(allSpecs);

  const visible = useMemo(() => {
    const status = filters.values[STATUS_KEY] ?? ANY;

    return rows.filter((row) => {
      if (!filters.matches(CATEGORY_KEY, row.categoryKey)) return false;

      if (status === 'open' && !row.event.open) return false;
      if (status === 'closed' && row.event.open) return false;

      if (!filters.needle) return true;
      return row.haystack.includes(filters.needle);
    });
  }, [rows, filters]);

  // Group what survived the filters, so a narrowed list keeps its headings and
  // an emptied category drops out rather than showing a heading over nothing.
  const sections = useMemo<Section[]>(
    () =>
      CATEGORY_FRAMES.map((frame) => ({
        ...frame,
        events: visible.filter((row) => row.categoryKey === frame.key).map((row) => row.event),
      })).filter((section) => section.events.length > 0),
    [visible],
  );

  /* ------------------------------------------------------------- render --- */

  if (loadError) {
    return <ErrorState title="Could not load events" description={loadError} onRetry={load} />;
  }

  const total = events?.length ?? 0;
  const openCount = events?.filter((e) => e.open).length ?? 0;

  return (
    <FestivalScreen
      title="Events"
      subtitle={
        events === null
          ? 'Loading the programme…'
          : `${total} event${total === 1 ? '' : 's'} · ${openCount} open for registration`
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
      ) : total === 0 ? (
        <EmptyState
          title="No events yet"
          description="Create one and it appears here and in the public catalogue."
          icon={Ticket}
        />
      ) : (
        <>
          {/* Above the grid rather than in a panel of its own: the programme is
              the page, and the toolbar reads as narrowing what follows it. */}
          <ListToolbar
            filters={filters}
            specs={[categorySpec]}
            advancedSpecs={[STATUS_SPEC]}
            searchLabel="Search events"
            searchPlaceholder="Search events by name, ID, round, or venue…"
            shown={visible.length}
            total={total}
            noun="events"
          />

          {visible.length === 0 ? (
            <EmptyState
              title="No matching events"
              description="Try a different search, or clear the filters."
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
        </>
      )}

      {actions.dialog}
    </FestivalScreen>
  );
}
