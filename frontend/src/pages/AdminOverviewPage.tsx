import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '@/api';
import type { OperationalOverview } from '@/api/types';
import { ROUTES } from '@/config/routes';
import { Card, Skeleton, ErrorState } from '@/components/ui';

type Status = 'loading' | 'error' | 'loaded';

/**
 * Operational dashboard (Epic 9, FR-9.1): a single admin screen summarizing
 * event attendance/crowd, open queries, hostel, and mess — each linking to the
 * detailed view. Admin+ only. All figures come from the shared data stores
 * (FR-9.3), so nothing is a parallel copy.
 */
export default function AdminOverviewPage() {
  const navigate = useNavigate();
  const [status, setStatus] = useState<Status>('loading');
  const [data, setData] = useState<OperationalOverview | null>(null);

  async function load() {
    setStatus('loading');
    try {
      setData(await api.getOverview());
      setStatus('loaded');
    } catch {
      setStatus('error');
    }
  }

  useEffect(() => {
    void load();
  }, []);

  return (
    <main className="mx-auto flex min-h-full max-w-2xl flex-col gap-4 p-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-gray-900">Operations</h1>
          <p className="text-sm text-muted">Live snapshot across all modules.</p>
        </div>
        <button
          type="button"
          onClick={() => navigate(ROUTES.home)}
          className="text-sm text-muted hover:text-brand"
        >
          ← Home
        </button>
      </div>

      {status === 'loading' && (
        <div className="grid grid-cols-2 gap-3">
          <Skeleton className="h-28" />
          <Skeleton className="h-28" />
          <Skeleton className="h-28" />
          <Skeleton className="h-28" />
        </div>
      )}
      {status === 'error' && (
        <ErrorState description="Could not load the dashboard." onRetry={() => void load()} />
      )}

      {status === 'loaded' && data && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Link to={ROUTES.dashboard} className="block">
            <Card className="h-full transition-colors hover:border-brand">
              <p className="text-sm font-semibold text-gray-800">📅 Events &amp; Crowd</p>
              <div className="mt-2 flex items-end gap-4">
                <Stat value={data.events.active} label="Active" />
                <Stat value={data.events.totalCheckedIn} label="Checked in" />
                <Stat
                  value={data.events.atCapacity}
                  label="At capacity"
                  danger={data.events.atCapacity > 0}
                />
              </div>
            </Card>
          </Link>

          <Link to={ROUTES.manageQueries} className="block">
            <Card className="h-full transition-colors hover:border-brand">
              <p className="text-sm font-semibold text-gray-800">🗂️ Open Queries</p>
              <div className="mt-2 flex items-end gap-4">
                <Stat value={data.queries.unresolved} label="Unresolved" danger={data.queries.unresolved > 0} />
                <Stat value={data.queries.inProgress} label="In progress" />
                <Stat value={data.queries.resolved} label="Resolved" />
              </div>
            </Card>
          </Link>

          <Link to={ROUTES.manageHostel} className="block">
            <Card className="h-full transition-colors hover:border-brand">
              <p className="text-sm font-semibold text-gray-800">🏨 Hostel</p>
              <div className="mt-2 flex items-end gap-4">
                <Stat value={data.hostel.allocations} label="Allocated" />
                <Stat value={data.hostel.checkedIn} label="Checked in" />
              </div>
            </Card>
          </Link>

          <Link to={ROUTES.manageMess} className="block">
            <Card className="h-full transition-colors hover:border-brand">
              <p className="text-sm font-semibold text-gray-800">🍽️ Mess</p>
              <div className="mt-2 flex items-end gap-4">
                <Stat value={data.mess.eligible} label="Opted in" />
              </div>
            </Card>
          </Link>
        </div>
      )}
    </main>
  );
}

function Stat({ value, label, danger }: { value: number; label: string; danger?: boolean }) {
  return (
    <div>
      <p className={`text-2xl font-bold ${danger ? 'text-danger' : 'text-gray-900'}`}>{value}</p>
      <p className="text-xs text-muted">{label}</p>
    </div>
  );
}
