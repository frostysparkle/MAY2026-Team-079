import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '@/api';
import type { EventItem } from '@/api/types';
import { ROUTES } from '@/config/routes';
import { useAuthStore } from '@/stores/authStore';
import { hasRoleAtLeast } from '@/stores/authStore';
import { Card, Skeleton, EmptyState, ErrorState, FAB } from '@/components/ui';

type Status = 'loading' | 'error' | 'loaded';

const STATUS_BADGE: Record<EventItem['status'], string> = {
  published: 'bg-green-100 text-green-700',
  draft: 'bg-amber-100 text-amber-700',
  cancelled: 'bg-red-100 text-red-700',
};

/**
 * Event schedule (FR-1.1). Every authenticated participant can browse published
 * events; organizers and above additionally see drafts/cancelled and get a FAB
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
  }, [participant?.id]);

  return (
    <div className="flex flex-col gap-4 p-4">
      <div>
        <h1 className="text-xl font-black tracking-tight text-ink">Events</h1>
        <p className="text-sm text-muted">Schedule, venues, and entry instructions.</p>
      </div>

      {status === 'loading' && (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
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
            <Card interactive className="flex gap-3">
              {/* Date chip */}
              <div className="flex h-14 w-14 shrink-0 flex-col items-center justify-center rounded-2xl bg-brand-100 text-brand">
                <span className="text-lg font-black leading-none">
                  {e.eventDate.slice(8, 10)}
                </span>
                <span className="text-[10px] font-semibold uppercase">
                  {monthAbbr(e.eventDate)}
                </span>
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-2">
                  <p className="font-semibold text-ink">{e.title}</p>
                  {canManage ? (
                    <span
                      className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGE[e.status]}`}
                    >
                      {e.status}
                    </span>
                  ) : e.registered ? (
                    <span className="shrink-0 rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
                      ✓ Registered
                    </span>
                  ) : e.spotsLeft === 0 ? (
                    <span className="shrink-0 rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
                      Full
                    </span>
                  ) : null}
                </div>
                <p className="truncate text-sm text-muted">{e.venue}</p>
                <p className="mt-1 text-xs text-muted">
                  {e.startTime}–{e.endTime}
                </p>
              </div>
            </Card>
          </Link>
        ))}

      {canManage && (
        <Link to={ROUTES.newEvent}>
          <FAB label="New event" icon="+" extended="New" />
        </Link>
      )}
    </div>
  );
}

function monthAbbr(isoDate: string): string {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const m = Number(isoDate.slice(5, 7));
  return months[m - 1] ?? '';
}
