import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ExternalLink, Pencil, Users } from 'lucide-react';
import { api, ApiClientError } from '@/api';
import type { Event } from '@/api/types';
import { path, ROUTES } from '@/config/routes';
import {
  ActionMenu,
  Button,
  ErrorState,
  ResultBanner,
  Skeleton,
  StatusBadge,
} from '@/components/ui';
import { FestivalScreen } from '@/components/layout/FestivalScreen';
import { EventDetailView } from '@/components/events/EventDetailView';
import { fullEventView } from '@/features/events/eventView';
import { useAdminEventActions } from '@/features/events/adminEventActions';

/**
 * An event as the Super Admin sees it — the same page a visitor gets, rendered by
 * the very same `EventDetailView`, so what an admin reviews is what the public
 * reads. The admin layer is the bar of actions above it and the "⋮" menu.
 *
 * Uses `fullEventView`, which (unlike the public one) also frames events with
 * `event_type: 'others'`: they have no public page, but they still need managing.
 */
export default function AdminEventDetailPage() {
  const { eventId = '' } = useParams<{ eventId: string }>();
  const navigate = useNavigate();
  const [event, setEvent] = useState<Event | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Clearing the error on success rather than up front keeps this free of a
  // synchronous setState when it runs as the mount effect.
  function load() {
    api
      .listEvents()
      .then((events) => {
        const found = events.find((e) => e.event_id === eventId);
        if (!found) {
          setLoadError('That event no longer exists.');
          return;
        }
        setEvent(found);
        setLoadError(null);
      })
      .catch((e) =>
        setLoadError(e instanceof ApiClientError ? e.message : 'Could not load the event.'),
      );
  }
  useEffect(load, [eventId]);

  const actions = useAdminEventActions({
    onChanged: load,
    // The event is gone, so there is nothing left to show here.
    onDeleted: () => navigate(ROUTES.adminEvents),
  });

  const backToEvents = { label: 'Events', onClick: () => navigate(ROUTES.adminEvents) };

  if (loadError) {
    return (
      <FestivalScreen title="Event" back={backToEvents}>
        <ErrorState title="Could not load event" description={loadError} onRetry={load} />
      </FestivalScreen>
    );
  }

  if (!event) {
    return (
      <FestivalScreen title="Event" back={backToEvents}>
        <Skeleton className="h-96" />
      </FestivalScreen>
    );
  }

  const view = fullEventView(event);
  const publicSlug = view.category.slug;

  return (
    <FestivalScreen
      title={view.category.label}
      eyebrow="Super Admin"
      subtitle={event.registration.is_open ? 'Registration is open' : 'Registration is closed'}
      back={backToEvents}
      actions={
        <>
          <Button
            onClick={() => navigate(path(ROUTES.adminEventEdit, { eventId: event.event_id }))}
            className="gap-1.5"
          >
            <Pencil size={14} /> Edit
          </Button>
          <Button
            variant="secondary"
            onClick={() => navigate(path(ROUTES.eventParticipation, { eventId: event.event_id }))}
            className="gap-1.5"
          >
            <Users size={14} /> View participants
          </Button>
          {publicSlug && (
            <Button
              variant="ghost"
              onClick={() =>
                navigate(
                  path(ROUTES.publicEventDetail, {
                    category: publicSlug,
                    eventId: event.event_id,
                  }),
                )
              }
              className="gap-1.5"
            >
              <ExternalLink size={14} /> Public page
            </Button>
          )}
          <ActionMenu label={`Actions for ${event.name}`} items={actions.itemsFor(event)} />
        </>
      }
    >
      {actions.error && (
        <ResultBanner variant="error" title="Action failed">
          {actions.error}
        </ResultBanner>
      )}

      {!event.registration.is_open && (
        <div>
          <StatusBadge tone="neutral">Closed for registration</StatusBadge>
        </div>
      )}

      {!publicSlug && (
        <ResultBanner variant="warning" title="Not in the public catalogue">
          This event's category is “{event.event_type}”, which has no public page. Change its
          category to Technicals, Culturals, or Sports to publish it.
        </ResultBanner>
      )}

      <EventDetailView view={view} />

      {actions.dialog}
    </FestivalScreen>
  );
}
