import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '@/api';
import type { EventItem } from '@/api/types';
import { ROUTES } from '@/config/routes';
import { hasRoleAtLeast } from '@/stores/authStore';
import { Card, Button, Skeleton, ErrorState } from '@/components/ui';

type Status = 'loading' | 'error' | 'loaded';

/**
 * Event detail with entry instructions (FR-1.4). If no instructions are set, an
 * explicit fallback renders rather than a blank area. Organizers and above get
 * an Edit action.
 */
export default function EventDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const canManage = hasRoleAtLeast('organizer');

  const [status, setStatus] = useState<Status>('loading');
  const [event, setEvent] = useState<EventItem | null>(null);

  async function load() {
    setStatus('loading');
    try {
      setEvent(await api.getEvent(id));
      setStatus('loaded');
    } catch {
      setStatus('error');
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  return (
    <div className="flex flex-col gap-4 p-4">
      <button
        type="button"
        onClick={() => navigate(ROUTES.events)}
        className="self-start text-sm text-muted hover:text-brand"
      >
        ← All events
      </button>

      {status === 'loading' && <Skeleton className="h-40" />}
      {status === 'error' && (
        <ErrorState description="Could not load this event." onRetry={() => void load()} />
      )}

      {status === 'loaded' && event && (
        <>
          <div className="flex items-start justify-between gap-3">
            <div>
              <h1 className="text-xl font-bold text-gray-900">{event.title}</h1>
              <p className="text-sm text-muted">{event.venue}</p>
            </div>
            {canManage && (
              <Link to={ROUTES.editEvent(event.id)}>
                <Button variant="secondary">Edit</Button>
              </Link>
            )}
          </div>

          <Card className="flex flex-col gap-2">
            <Row label="Date" value={event.eventDate} />
            <Row label="Time" value={`${event.startTime} – ${event.endTime}`} />
            <Row label="Capacity" value={String(event.capacity)} />
            {canManage && <Row label="Status" value={event.status} />}
          </Card>

          <div>
            <h2 className="mb-1 text-sm font-semibold text-gray-800">Entry instructions</h2>
            {event.instructions.trim() ? (
              <p className="whitespace-pre-line text-sm text-gray-700">{event.instructions}</p>
            ) : (
              <p className="text-sm text-muted">No specific instructions for this event.</p>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3 text-sm">
      <span className="text-muted">{label}</span>
      <span className="font-medium text-gray-900">{value}</span>
    </div>
  );
}
