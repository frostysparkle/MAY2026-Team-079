import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Wrench } from 'lucide-react';
import { api, ApiClientError } from '@/api';
import type { Workshop } from '@/api/types';
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
import { EVENT_GRID_CLASS, EventPosterCard } from '@/features/events/EventPosterCard';
import { useAdminWorkshopActions } from '@/features/workshops/adminWorkshopActions';
import {
  workshopDays,
  workshopView,
  sortWorkshops,
  WORKSHOP_COVER,
  type WorkshopView,
} from '@/features/workshops/workshopView';
import { shiftLabel, workshopDayLabel, WORKSHOP_SHIFTS } from '@/features/workshops/workshopSlot';

/**
 * Super Admin workshop dashboard, dressed as the festival programme — the same
 * poster grid the public catalogue uses, grouped by the day each workshop runs
 * on, so an admin sees what visitors see.
 *
 * Authoring lives in `AdminWorkshopEditorPage`. Mirrors `AdminEventsPage`.
 */

/** Workshops whose slot id carries no date still need somewhere to live. */
const UNDATED = 'Unscheduled';

/** URL query keys. Kept short: they are user-visible in a shared link. */
const DAY_KEY = 'day';
const SHIFT_KEY = 'shift';
const SEATS_KEY = 'seats';

/**
 * Both live in the advanced row, where `ListToolbar` renders the label on screen
 * — hence short nouns and "Any …" catch-alls, matching Staffing on Hostels
 * rather than the "Filter by …" phrasing the sr-only inline labels use.
 */
const SHIFT_SPEC: FilterSpec = {
  key: SHIFT_KEY,
  label: 'Shift',
  anyLabel: 'Any shift',
  options: WORKSHOP_SHIFTS.map((shift) => ({ value: shift, label: shiftLabel(shift) })),
};

const SEATS_SPEC: FilterSpec = {
  key: SEATS_KEY,
  label: 'Seats',
  anyLabel: 'Any seats',
  options: [
    { value: 'available', label: 'Seats available' },
    { value: 'full', label: 'Full' },
  ],
};

/** A workshop view plus the text the search box matches against. */
interface WorkshopRow {
  view: WorkshopView;
  /** Lowercased haystack, joined once at load rather than per keystroke. */
  haystack: string;
}

/** A day heading plus the workshops running that day. */
interface Section {
  key: string;
  label: string;
  views: WorkshopView[];
}

export default function AdminWorkshopsPage() {
  const navigate = useNavigate();
  const [workshops, setWorkshops] = useState<Workshop[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Clearing the error on success rather than up front keeps this free of a
  // synchronous setState when it runs as the mount effect.
  function load() {
    api
      .listWorkshops()
      .then((all) => {
        setWorkshops(all);
        setLoadError(null);
      })
      .catch((e) =>
        setLoadError(e instanceof ApiClientError ? e.message : 'Could not load workshops.'),
      );
  }
  useEffect(load, []);

  const actions = useAdminWorkshopActions({ onDeleted: load });

  /* ----------------------------------------------------- filter / search --- */

  // Sorted here rather than after filtering: programme order is a property of
  // the collection, not of whatever the current search left behind.
  const views = useMemo(
    () => (workshops ? sortWorkshops(workshops.map(workshopView)) : []),
    [workshops],
  );

  const rows = useMemo<WorkshopRow[]>(
    () =>
      views.map((view) => ({
        view,
        haystack: [
          view.name,
          view.id,
          view.venue,
          view.dayLabel,
          view.slot.shift && shiftLabel(view.slot.shift),
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase(),
      })),
    [views],
  );

  // Days come from the programme itself, so the filter can only offer a day that
  // something actually runs on.
  const daySpec = useMemo<FilterSpec>(
    () => ({
      key: DAY_KEY,
      label: 'Filter by day',
      anyLabel: 'All days',
      options: workshopDays(views).map((day) => ({ value: day.date, label: day.label })),
    }),
    [views],
  );

  const allSpecs = useMemo(() => [daySpec, SHIFT_SPEC, SEATS_SPEC], [daySpec]);
  const filters = useListFilters(allSpecs);

  const visible = useMemo(() => {
    const seats = filters.values[SEATS_KEY] ?? ANY;

    return rows.filter((row) => {
      if (!filters.matches(DAY_KEY, row.view.slot.date)) return false;
      if (!filters.matches(SHIFT_KEY, row.view.slot.shift)) return false;

      // `seatsLeft` is undefined when the record carries no registration count.
      // An unknown count is not evidence either way, so it answers neither
      // "available" nor "full" rather than being guessed into one of them.
      const { seatsLeft } = row.view;
      if (seats === 'available' && (seatsLeft === undefined || seatsLeft === 0)) return false;
      if (seats === 'full' && seatsLeft !== 0) return false;

      if (!filters.needle) return true;
      return row.haystack.includes(filters.needle);
    });
  }, [rows, filters]);

  // Group what survived the filters, so a narrowed programme keeps its day
  // headings and an emptied day drops out rather than heading nothing.
  const sections = useMemo<Section[]>(() => {
    const byDay = new Map<string, Section>();
    for (const { view } of visible) {
      const key = view.slot.date ?? UNDATED;
      const label = view.slot.date ? workshopDayLabel(view.slot.date) : UNDATED;
      const section = byDay.get(key) ?? { key, label, views: [] };
      section.views.push(view);
      byDay.set(key, section);
    }
    return [...byDay.values()];
  }, [visible]);

  /* ------------------------------------------------------------- render --- */

  if (loadError) {
    return <ErrorState title="Could not load workshops" description={loadError} onRetry={load} />;
  }

  const total = workshops?.length ?? 0;
  const totalSeats = workshops?.reduce((sum, w) => sum + w.capacity, 0) ?? 0;

  return (
    <FestivalScreen
      title="Workshops"
      subtitle={
        workshops === null
          ? 'Loading the programme…'
          : `${total} workshop${total === 1 ? '' : 's'} · ${totalSeats} seats`
      }
      actions={
        <Button onClick={() => navigate(ROUTES.adminWorkshopNew)} className="gap-1.5">
          <Plus size={15} strokeWidth={2.5} /> New workshop
        </Button>
      }
    >
      {actions.error && (
        <ResultBanner variant="error" title="Action failed">
          {actions.error}
        </ResultBanner>
      )}

      {workshops === null ? (
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
          title="No workshops yet"
          description="Create one and it appears here and in the public catalogue."
          icon={Wrench}
        />
      ) : (
        <>
          {/* Above the grid rather than in a panel of its own: the programme is
              the page, and the toolbar reads as narrowing what follows it. */}
          <ListToolbar
            filters={filters}
            specs={[daySpec]}
            advancedSpecs={[SHIFT_SPEC, SEATS_SPEC]}
            searchLabel="Search workshops"
            searchPlaceholder="Search workshops by name, ID, or venue…"
            shown={visible.length}
            total={total}
            noun="workshops"
          />

          {visible.length === 0 ? (
            <EmptyState
              title="No matching workshops"
              description="Try a different search, or clear the filters."
              icon={Wrench}
            />
          ) : (
            sections.map((section) => (
              <section key={section.key} className="flex flex-col gap-4">
                <SectionHeading
                  title={section.label}
                  meta={`${section.views.length} workshop${section.views.length === 1 ? '' : 's'}`}
                />

                <ul className={EVENT_GRID_CLASS}>
                  {section.views.map((view) => (
                    <EventPosterCard
                      key={view.id}
                      to={path(ROUTES.adminWorkshopEdit, { workshopId: view.id })}
                      name={view.name}
                      poster={view.poster}
                      fallbackImage={WORKSHOP_COVER}
                      meta={[view.slot.shift && shiftLabel(view.slot.shift), view.venue]
                        .filter(Boolean)
                        .join(' · ')}
                      badge={
                        view.seatsLeft === 0 && (
                          <StatusBadge tone="danger" className="shadow-card ring-1 ring-line">
                            Full
                          </StatusBadge>
                        )
                      }
                      overlay={
                        view.workshop && (
                          <ActionMenu
                            label={`Actions for ${view.name}`}
                            items={actions.itemsFor(view.workshop)}
                          />
                        )
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
