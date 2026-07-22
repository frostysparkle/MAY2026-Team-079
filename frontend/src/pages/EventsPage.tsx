import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '@/api';
import type { EventItem } from '@/api/types';
import { ROUTES } from '@/config/routes';
import { useAuthStore } from '@/stores/authStore';
import { hasRoleAtLeast } from '@/stores/authStore';
import { Card, Button, Skeleton, EmptyState, ErrorState } from '@/components/ui';

type Status = 'loading' | 'error' | 'loaded';

const STATUS_BADGE: Record<EventItem['status'], string> = {
  published: 'bg-green-100 text-green-700',
  draft: 'bg-amber-100 text-amber-700',
  cancelled: 'bg-red-100 text-red-700',
};

/**
 * Event schedule (FR-1.1). Every authenticated participant can browse published
 * events; organizers and above additionally see drafts/cancelled and a control
 * to create a new event (FR-1.3).
 */
export default function EventsPage() {
  const participant = useAuthStore((s) => s.participant);
  const canManage = hasRoleAtLeast('organizer');

  const [status, setStatus] = useState<Status>('loading');
  const [events, setEvents] = useState<EventItem[]>([]);

  async function load() {
    setStatus('loading');
    try {
      const { events } = await api.listEvents();
      setEvents(events);
      setStatus('loaded');
    } catch {
      setStatus('error');
    }
  }

  useEffect(() => {
    void load();
    // participant identity can change the visible set (drafts for organizers).
  }, [participant?.id]);

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-gray-900">Events</h1>
          <p className="text-sm text-muted">Schedule, venues, and entry instructions.</p>
        </div>
        {canManage && (
          <Link to={ROUTES.newEvent}>
            <Button>New</Button>
          </Link>
        )}
      </div>

      {status === 'loading' && (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-20" />
          <Skeleton className="h-20" />
        </div>
      )}

      {status === 'error' && (
        <ErrorState description="Could not load events." onRetry={() => void load()} />
      )}

      {status === 'loaded' && events.length === 0 && (
        <EmptyState title="No events yet" description="Check back soon for the schedule." icon="📅" />
      )}

      {status === 'loaded' &&
        events.map((e) => (
          <Link key={e.id} to={ROUTES.eventDetail(e.id)} className="block">
            <Card className="transition-colors hover:border-brand">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-semibold text-gray-900">{e.title}</p>
                  <p className="truncate text-sm text-muted">{e.venue}</p>
                  <p className="mt-1 text-xs text-muted">
                    {e.eventDate} · {e.startTime}–{e.endTime}
                  </p>
                </div>
                {canManage && (
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGE[e.status]}`}
                  >
                    {e.status}
                  </span>
                )}
              </div>
            </Card>
          </Link>
        ))}
    </div>
  );
}
