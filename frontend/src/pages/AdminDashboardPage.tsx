import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '@/api';
import type { CrowdStatus, DashboardEvent } from '@/api/types';
import { ROUTES } from '@/config/routes';
import { AdminScreen } from '@/components/layout/AdminScreen';
import { Card, Skeleton, EmptyState, ErrorState } from '@/components/ui';

type Status = 'loading' | 'error' | 'loaded';

const CROWD: Record<CrowdStatus, { label: string; className: string }> = {
  available: { label: 'Available', className: 'bg-green-100 text-green-700' },
  filling_fast: { label: 'Filling fast', className: 'bg-amber-100 text-amber-700' },
  full: { label: 'Full', className: 'bg-red-100 text-red-700' },
};

/**
 * Live crowd dashboard (FR-3.4): every active (published) event with current
 * attendance and remaining capacity in one screen. Admin+ only. Auto-refreshes
 * so figures stay current during the fest.
 */
export default function AdminDashboardPage() {
  const navigate = useNavigate();
  const [status, setStatus] = useState<Status>('loading');
  const [events, setEvents] = useState<DashboardEvent[]>([]);

  async function load(initial = false) {
    if (initial) setStatus('loading');
    try {
      const { events } = await api.getAttendanceDashboard();
      setEvents(events);
      setStatus('loaded');
    } catch {
      if (initial) setStatus('error');
    }
  }

  useEffect(() => {
    void load(true);
    const timer = setInterval(() => void load(), 15000);
    return () => clearInterval(timer);
  }, []);

  return (
    <AdminScreen
      title="Live Crowd"
      subtitle="Attendance across active events."
      onBack={() => navigate(ROUTES.home)}
    >

      {status === 'loading' && <Skeleton className="h-24" />}
      {status === 'error' && (
        <ErrorState description="Could not load the dashboard." onRetry={() => void load(true)} />
      )}
      {status === 'loaded' && events.length === 0 && (
        <EmptyState title="No active events" description="Published events will appear here." icon="📊" />
      )}

      {status === 'loaded' &&
        events.map((e) => (
          <Link key={e.eventId} to={ROUTES.eventDetail(e.eventId)} className="block">
            <Card className="transition-colors hover:border-brand">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-semibold text-ink">{e.title}</p>
                  <p className="truncate text-sm text-muted">{e.venue}</p>
                </div>
                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${CROWD[e.status].className}`}
                >
                  {CROWD[e.status].label}
                </span>
              </div>
              <div className="mt-3 flex items-center justify-around text-center">
                <div>
                  <p className="text-lg font-bold text-ink">{e.attendance}</p>
                  <p className="text-xs text-muted">In</p>
                </div>
                <div>
                  <p className="text-lg font-bold text-ink">{e.remaining}</p>
                  <p className="text-xs text-muted">Left</p>
                </div>
                <div>
                  <p className="text-lg font-bold text-ink">{e.capacity}</p>
                  <p className="text-xs text-muted">Cap</p>
                </div>
              </div>
            </Card>
          </Link>
        ))}
    </AdminScreen>
  );
}
