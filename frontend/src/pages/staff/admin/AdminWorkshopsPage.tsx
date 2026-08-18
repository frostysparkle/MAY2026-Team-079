import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Wrench } from 'lucide-react';
import { api, ApiClientError } from '@/api';
import type { Workshop } from '@/api/types';
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
import { EVENT_GRID_CLASS, EventPosterCard } from '@/features/events/EventPosterCard';
import { useAdminWorkshopActions } from '@/features/workshops/adminWorkshopActions';
import { workshopView, sortWorkshops, WORKSHOP_COVER } from '@/features/workshops/workshopView';
import { shiftLabel, workshopDayLabel } from '@/features/workshops/workshopSlot';

/**
 * Super Admin workshop dashboard, dressed as the festival programme — the same
 * poster grid the public catalogue uses, grouped by the day each workshop runs
 * on, so an admin sees what visitors see.
 *
 * Authoring lives in `AdminWorkshopEditorPage`. Mirrors `AdminEventsPage`.
 */

/** A day heading plus the workshops running that day. */
interface Section {
  key: string;
  label: string;
  views: ReturnType<typeof workshopView>[];
}

/** Workshops whose slot id carries no date still need somewhere to live. */
const UNDATED = 'Unscheduled';

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

  const sections = useMemo<Section[]>(() => {
    if (!workshops) return [];
    const views = sortWorkshops(workshops.map(workshopView));

    const byDay = new Map<string, Section>();
    for (const view of views) {
      const key = view.slot.date ?? UNDATED;
      const label = view.slot.date ? workshopDayLabel(view.slot.date) : UNDATED;
      const section = byDay.get(key) ?? { key, label, views: [] };
      section.views.push(view);
      byDay.set(key, section);
    }
    return [...byDay.values()];
  }, [workshops]);

  if (loadError) {
    return <ErrorState title="Could not load workshops" description={loadError} onRetry={load} />;
  }

  const totalSeats = workshops?.reduce((sum, w) => sum + w.capacity, 0) ?? 0;

  return (
    <FestivalScreen
      title="Workshops"
      subtitle={
        workshops === null
          ? 'Loading the programme…'
          : `${workshops.length} workshop${workshops.length === 1 ? '' : 's'} · ${totalSeats} seats`
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
      ) : workshops.length === 0 ? (
        <EmptyState
          title="No workshops yet"
          description="Create one and it appears here and in the public catalogue."
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

      {actions.dialog}
    </FestivalScreen>
  );
}
