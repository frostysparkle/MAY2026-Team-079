import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '@/api';
import type { HostelAllocation } from '@/api/types';
import { ROUTES } from '@/config/routes';
import { Card, Skeleton, EmptyState, ErrorState } from '@/components/ui';

type Status = 'loading' | 'error' | 'loaded';

/**
 * Hostel screen (Epic 5, FR-5.1): the participant's allocation, check-in
 * instructions, coordinator contact (FR-5.3), and check-in status. An explicit
 * empty state renders when no accommodation is assigned.
 */
export default function HostelPage() {
  const [status, setStatus] = useState<Status>('loading');
  const [allocation, setAllocation] = useState<HostelAllocation | null>(null);

  async function load() {
    setStatus('loading');
    try {
      const { allocation } = await api.getMyAllocation();
      setAllocation(allocation);
      setStatus('loaded');
    } catch {
      setStatus('error');
    }
  }

  useEffect(() => {
    void load();
  }, []);

  return (
    <div className="flex flex-col gap-4 p-4">
      <div>
        <h1 className="text-xl font-black tracking-tight text-ink">Hostel</h1>
        <p className="text-sm text-muted">Your accommodation and check-in details.</p>
      </div>

      {status === 'loading' && <Skeleton className="h-40" />}
      {status === 'error' && (
        <ErrorState description="Could not load your allocation." onRetry={() => void load()} />
      )}

      {status === 'loaded' && !allocation && (
        <EmptyState
          title="No accommodation assigned"
          description="If you booked hostel accommodation, it will appear here once allocated."
          icon="🏨"
        />
      )}

      {status === 'loaded' && allocation && (
        <>
          <Card className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-lg font-bold text-gray-900">{allocation.hostelBlock}</p>
                <p className="text-sm text-muted">Room {allocation.room}</p>
              </div>
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                  allocation.checkedIn
                    ? 'bg-green-100 text-green-700'
                    : 'bg-amber-100 text-amber-700'
                }`}
              >
                {allocation.checkedIn ? 'Checked in' : 'Not checked in'}
              </span>
            </div>
          </Card>

          <div>
            <h2 className="mb-1 text-sm font-semibold text-gray-800">Check-in instructions</h2>
            {allocation.instructions.trim() ? (
              <p className="whitespace-pre-line text-sm text-gray-700">{allocation.instructions}</p>
            ) : (
              <p className="text-sm text-muted">No specific instructions provided.</p>
            )}
          </div>

          {allocation.coordinator && (
            <div>
              <h2 className="mb-1 text-sm font-semibold text-gray-800">Hostel coordinator</h2>
              <p className="text-sm text-gray-700">{allocation.coordinator}</p>
            </div>
          )}

          <p className="text-sm text-muted">
            Show your <Link to={ROUTES.myQr} className="font-medium text-brand">digital ID</Link> at
            the hostel checkpoint to check in.
          </p>
        </>
      )}

      <Link
        to={ROUTES.help}
        state={{ category: 'hostel' }}
        className="text-center text-sm font-medium text-brand hover:underline"
      >
        Report a hostel issue
      </Link>
    </div>
  );
}
