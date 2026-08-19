import { useMemo, useState } from 'react';
import { path, ROUTES } from '@/config/routes';
import { PublicPageChrome } from '@/features/landing/PublicPageChrome';
import { EmptyState, Select, Skeleton } from '@/components/ui';
import { announce } from '@/components/a11y/Announcer';
import { cn } from '@/lib/cn';
import { EVENT_GRID_CLASS, EventPosterCard } from '@/features/events/EventPosterCard';
import { usePublicWorkshops } from '@/features/workshops/usePublicWorkshops';
import { workshopDays, WORKSHOP_COVER } from '@/features/workshops/workshopView';
import { shiftLabel, WORKSHOP_SHIFTS } from '@/features/workshops/workshopSlot';

/**
 * Public, pre-login workshops catalogue — the flyer grid, filterable by day and
 * shift.
 *
 * The programme comes from `GET /workshops/public`, so a visitor with no
 * account sees exactly what the Super Admin has published. The day and shift a
 * workshop runs in are carried by its `slot_id`; see `workshopSlot.ts`.
 */

const ALL = 'all';

export default function PublicWorkshopsPage() {
  const { views, loading } = usePublicWorkshops();
  const [day, setDay] = useState<string>(ALL);
  const [shift, setShift] = useState<string>(ALL);

  const days = useMemo(() => workshopDays(views), [views]);

  const visible = useMemo(
    () =>
      views.filter(
        (w) => (day === ALL || w.slot.date === day) && (shift === ALL || w.slot.shift === shift),
      ),
    [views, day, shift],
  );

  function updateDay(next: string) {
    setDay(next);
    announce(`${countFor(views, next, shift)} workshops shown`);
  }
  function updateShift(next: string) {
    setShift(next);
    announce(`${countFor(views, day, next)} workshops shown`);
  }

  return (
    <PublicPageChrome title="Workshops" active="Workshops" width="xl">
      <div className="mt-8 flex flex-col gap-6">
        <p className="text-center text-sm text-muted">
          You can book only one workshop per shift on each day.
        </p>

        <div className="mx-auto grid w-full max-w-md grid-cols-2 gap-3">
          <Select
            label="Day"
            value={day}
            onChange={(e) => updateDay(e.target.value)}
            options={[
              { value: ALL, label: `All days (${views.length})` },
              ...days.map((d) => ({ value: d.date, label: `${d.label} (${d.count})` })),
            ]}
          />
          <Select
            label="Shift"
            value={shift}
            onChange={(e) => updateShift(e.target.value)}
            options={[
              { value: ALL, label: 'All shifts' },
              ...WORKSHOP_SHIFTS.map((s) => ({ value: s, label: shiftLabel(s) })),
            ]}
          />
        </div>

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
        ) : visible.length === 0 ? (
          <EmptyState
            title={views.length === 0 ? 'No workshops published yet' : 'No workshops match'}
            description={
              views.length === 0
                ? 'The programme will appear here once workshops are published.'
                : 'Try a different day or shift combination.'
            }
          />
        ) : (
          <ul className={cn(EVENT_GRID_CLASS)}>
            {visible.map((w) => (
              <EventPosterCard
                key={w.id}
                to={path(ROUTES.publicWorkshopDetail, { workshopId: w.id })}
                name={w.name}
                poster={w.poster}
                fallbackImage={WORKSHOP_COVER}
                meta={[w.dayLabel, w.slot.shift && shiftLabel(w.slot.shift)]
                  .filter(Boolean)
                  .join(' · ')}
              />
            ))}
          </ul>
        )}
      </div>
    </PublicPageChrome>
  );
}

function countFor(
  views: ReturnType<typeof usePublicWorkshops>['views'],
  day: string,
  shift: string,
): number {
  return views.filter(
    (w) => (day === ALL || w.slot.date === day) && (shift === ALL || w.slot.shift === shift),
  ).length;
}
