import { useMemo } from 'react';
import { path, ROUTES } from '@/config/routes';
import { PublicPageChrome } from '@/features/landing/PublicPageChrome';
import {
  EmptyState,
  ListToolbar,
  Skeleton,
  useListFilters,
  type FilterSpec,
} from '@/components/ui';
import { cn } from '@/lib/cn';
import { EVENT_GRID_CLASS, EventPosterCard } from '@/features/events/EventPosterCard';
import { usePublicWorkshops } from '@/features/workshops/usePublicWorkshops';
import { workshopDays, WORKSHOP_COVER, type WorkshopView } from '@/features/workshops/workshopView';
import { shiftLabel, WORKSHOP_SHIFTS } from '@/features/workshops/workshopSlot';

/**
 * Public, pre-login workshops catalogue — the flyer grid, searchable and
 * filterable by day and shift.
 *
 * The programme comes from `GET /workshops/public`, so a visitor with no
 * account sees exactly what the Super Admin has published. The day and shift a
 * workshop runs in are carried by its `slot_id`; see `workshopSlot.ts`.
 *
 * The filter is the same one the dashboard uses — `useListFilters` for
 * URL-backed state and `ListToolbar` for the single row of controls — so a
 * visitor and an admin narrow the programme the same way, and a filtered view
 * can be pasted into a chat and still open filtered. Mirrors
 * `pages/staff/admin/AdminWorkshopsPage.tsx`; the only field left out is Seats,
 * because the public record carries no registration count to filter on.
 */

/** URL query keys. Kept short: they are user-visible in a shared link. */
const DAY_KEY = 'day';
const SHIFT_KEY = 'shift';

/**
 * Lives in the advanced row, where `ListToolbar` renders the label on screen —
 * hence a short noun and an "Any …" catch-all, rather than the "Filter by …"
 * phrasing the sr-only inline labels use.
 */
const SHIFT_SPEC: FilterSpec = {
  key: SHIFT_KEY,
  label: 'Shift',
  anyLabel: 'Any shift',
  options: WORKSHOP_SHIFTS.map((shift) => ({ value: shift, label: shiftLabel(shift) })),
};

/** A workshop view plus the text the search box matches against. */
interface WorkshopRow {
  view: WorkshopView;
  /** Lowercased haystack, joined once at load rather than per keystroke. */
  haystack: string;
}

export default function PublicWorkshopsPage() {
  const { views, loading } = usePublicWorkshops();

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

  const allSpecs = useMemo(() => [daySpec, SHIFT_SPEC], [daySpec]);
  const filters = useListFilters(allSpecs);

  const visible = useMemo(
    () =>
      rows.filter((row) => {
        if (!filters.matches(DAY_KEY, row.view.slot.date)) return false;
        if (!filters.matches(SHIFT_KEY, row.view.slot.shift)) return false;

        if (!filters.needle) return true;
        return row.haystack.includes(filters.needle);
      }),
    [rows, filters],
  );

  return (
    <PublicPageChrome title="Workshops" active="Workshops" width="xl">
      <div className="mt-8 flex flex-col gap-6">
        <p className="text-center text-sm text-muted">
          You can book only one workshop per shift on each day.
        </p>

        {loading ? (
          // Placeholders in the real grid, so the page does not reflow.
          <ul className={EVENT_GRID_CLASS} aria-busy="true">
            {Array.from({ length: 8 }, (_, i) => (
              <li key={i} className="flex flex-col gap-2">
                <Skeleton className="aspect-[4/5] w-full rounded-2xl" />
                <Skeleton className="h-4 w-3/4" />
              </li>
            ))}
          </ul>
        ) : views.length === 0 ? (
          <EmptyState
            title="No workshops published yet"
            description="The programme will appear here once workshops are published."
          />
        ) : (
          <>
            {/* Above the grid rather than in a panel of its own: the programme is
                the page, and the toolbar reads as narrowing what follows it. */}
            <ListToolbar
              filters={filters}
              specs={[daySpec]}
              advancedSpecs={[SHIFT_SPEC]}
              searchLabel="Search workshops"
              searchPlaceholder="Search workshops by name, ID, or venue…"
              shown={visible.length}
              total={views.length}
              noun="workshops"
            />

            {visible.length === 0 ? (
              <EmptyState
                title="No workshops match"
                description="Try a different search, or clear the filters."
              />
            ) : (
              <ul className={cn(EVENT_GRID_CLASS)}>
                {visible.map(({ view }) => (
                  <EventPosterCard
                    key={view.id}
                    to={path(ROUTES.publicWorkshopDetail, { workshopId: view.id })}
                    name={view.name}
                    poster={view.poster}
                    fallbackImage={WORKSHOP_COVER}
                    meta={[view.dayLabel, view.slot.shift && shiftLabel(view.slot.shift)]
                      .filter(Boolean)
                      .join(' · ')}
                  />
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </PublicPageChrome>
  );
}
