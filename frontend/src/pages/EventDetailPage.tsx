import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, ApiClientError } from '@/api';
import type { CrowdStatus, EventAttendance, EventItem } from '@/api/types';
import { ROUTES } from '@/config/routes';
import { hasRoleAtLeast } from '@/stores/authStore';
import { Card, Button, Skeleton, ErrorState, ResultBanner } from '@/components/ui';

type Status = 'loading' | 'error' | 'loaded';

const CROWD: Record<CrowdStatus, { label: string; className: string }> = {
  available: { label: 'Available', className: 'bg-green-100 text-green-700' },
  filling_fast: { label: 'Filling fast', className: 'bg-amber-100 text-amber-700' },
  full: { label: 'Full', className: 'bg-red-100 text-red-700' },
};

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
  const [crowd, setCrowd] = useState<CrowdStatus | null>(null);
  const [attendance, setAttendance] = useState<EventAttendance | null>(null);
  const [busy, setBusy] = useState(false);
  const [regError, setRegError] = useState<string | null>(null);

  async function load() {
    setStatus('loading');
    try {
      const e = await api.getEvent(id);
      setEvent(e);
      setStatus('loaded');
      // Crowd status is available for published events (FR-3.3).
      if (e.status === 'published') {
        api
          .getEventCrowd(id)
          .then((c) => setCrowd(c.status))
          .catch(() => undefined);
      }
      // Organizers see live attendance/remaining capacity (FR-3.1/3.2).
      if (canManage) {
        api
          .getEventAttendance(id)
          .then(setAttendance)
          .catch(() => undefined);
      }
    } catch {
      setStatus('error');
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function toggleRegistration() {
    if (!event) return;
    setBusy(true);
    setRegError(null);
    try {
      if (event.registered) {
        await api.cancelEventRegistration(event.id);
      } else {
        await api.registerEvent(event.id);
      }
      const fresh = await api.getEvent(event.id);
      setEvent(fresh);
    } catch (e) {
      setRegError(
        e instanceof ApiClientError ? e.message : 'Could not update your registration. Try again.',
      );
    } finally {
      setBusy(false);
    }
  }

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
              <h1 className="text-xl font-bold text-ink">{event.title}</h1>
              <p className="text-sm text-muted">{event.venue}</p>
              {crowd && (
                <span
                  className={`mt-1 inline-block rounded-full px-2 py-0.5 text-xs font-medium ${CROWD[crowd].className}`}
                >
                  {CROWD[crowd].label}
                </span>
              )}
            </div>
            {canManage && (
              <Link to={ROUTES.editEvent(event.id)}>
                <Button variant="secondary">Edit</Button>
              </Link>
            )}
          </div>

          {/* Participant registration (FR-7). Organizers manage instead. */}
          {!canManage && event.status === 'published' && (
            <Card className="flex flex-col gap-3">
              {regError && (
                <ResultBanner variant="error" title="Registration">
                  {regError}
                </ResultBanner>
              )}
              {event.registered ? (
                <>
                  <div className="flex items-center gap-2">
                    <span className="rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-semibold text-green-700">
                      ✓ You’re registered
                    </span>
                  </div>
                  <p className="text-sm text-muted">
                    Your pass is ready in My Pass. See you there!
                  </p>
                  <Button variant="secondary" loading={busy} onClick={() => void toggleRegistration()}>
                    Cancel registration
                  </Button>
                </>
              ) : event.spotsLeft === 0 ? (
                <>
                  <span className="self-start rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-semibold text-red-700">
                    Event full
                  </span>
                  <p className="text-sm text-muted">
                    This event has reached capacity. Check back in case spots open up.
                  </p>
                  <Button disabled fullWidth>
                    Register
                  </Button>
                </>
              ) : (
                <>
                  {typeof event.spotsLeft === 'number' && (
                    <p className="text-sm text-muted">
                      {event.spotsLeft} {event.spotsLeft === 1 ? 'spot' : 'spots'} left
                    </p>
                  )}
                  <Button fullWidth loading={busy} onClick={() => void toggleRegistration()}>
                    Register for this event
                  </Button>
                </>
              )}
            </Card>
          )}

          {canManage && attendance && (
            <Card className="flex items-center justify-around gap-3 text-center">
              <div>
                <p className="text-xl font-bold text-ink">{attendance.attendance}</p>
                <p className="text-xs text-muted">Checked in</p>
              </div>
              <div>
                <p className="text-xl font-bold text-ink">{attendance.remaining}</p>
                <p className="text-xs text-muted">Remaining</p>
              </div>
              <div>
                <p
                  className={`text-xl font-bold ${attendance.atCapacity ? 'text-danger' : 'text-ink'}`}
                >
                  {attendance.atCapacity ? 'Full' : attendance.capacity}
                </p>
                <p className="text-xs text-muted">{attendance.atCapacity ? 'At capacity' : 'Capacity'}</p>
              </div>
            </Card>
          )}

          <Card className="flex flex-col gap-2">
            <Row label="Date" value={event.eventDate} />
            <Row label="Time" value={`${event.startTime} – ${event.endTime}`} />
            <Row label="Capacity" value={String(event.capacity)} />
            {canManage && <Row label="Status" value={event.status} />}
          </Card>

          <div>
            <h2 className="mb-1 text-sm font-semibold text-ink">Entry instructions</h2>
            {event.instructions.trim() ? (
              <p className="whitespace-pre-line text-sm text-ink">{event.instructions}</p>
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
      <span className="font-medium text-ink">{value}</span>
    </div>
  );
}
