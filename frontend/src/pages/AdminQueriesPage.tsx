import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '@/api';
import type { QueryStatus, QueryTeam, SupportQuery } from '@/api/types';
import { ROUTES } from '@/config/routes';
import { AdminScreen } from '@/components/layout/AdminScreen';
import { toast } from '@/stores/uiStore';
import { Card, Skeleton, EmptyState, ErrorState } from '@/components/ui';

type Status = 'loading' | 'error' | 'loaded';

const STATUSES: QueryStatus[] = ['open', 'assigned', 'in_progress', 'resolved'];
const TEAMS: QueryTeam[] = ['event', 'hostel', 'mess', 'workshop', 'general'];

/**
 * Query triage (FR-6.3). Admin+ only (route-guarded and backend-enforced). Each
 * row lets an admin set the owning team and status; changes are optimistic and
 * rolled back on failure.
 */
export default function AdminQueriesPage() {
  const navigate = useNavigate();
  const [status, setStatus] = useState<Status>('loading');
  const [queries, setQueries] = useState<SupportQuery[]>([]);

  async function load() {
    setStatus('loading');
    try {
      const { queries } = await api.listAllQueries();
      setQueries(queries);
      setStatus('loaded');
    } catch {
      setStatus('error');
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function patch(id: string, change: { status?: QueryStatus; assignedTeam?: QueryTeam }) {
    const previous = queries;
    setQueries((qs) => qs.map((q) => (q.id === id ? { ...q, ...change } : q)));
    try {
      await api.updateQuery(id, change);
      toast.success('Query updated.');
    } catch {
      setQueries(previous);
      toast.error('Could not update the query.');
    }
  }

  return (
    <AdminScreen
      title="Query Triage"
      subtitle="Assign teams and update status."
      onBack={() => navigate(ROUTES.home)}
    >

      {status === 'loading' && <Skeleton className="h-24" />}
      {status === 'error' && (
        <ErrorState description="Could not load queries." onRetry={() => void load()} />
      )}
      {status === 'loaded' && queries.length === 0 && (
        <EmptyState title="No queries" description="Nothing to triage right now." icon="✅" />
      )}

      {status === 'loaded' &&
        queries.map((q) => (
          <Card key={q.id} className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium uppercase tracking-wide text-muted">
                {q.category.replace('_', ' ')}
              </span>
              <span className="text-xs text-muted">{q.createdAt.slice(0, 10)}</span>
            </div>
            <p className="text-sm text-ink">{q.description}</p>
            <div className="flex flex-wrap gap-2">
              <label className="flex items-center gap-1 text-xs text-muted">
                Team
                <select
                  aria-label={`Team for query ${q.id}`}
                  value={q.assignedTeam ?? ''}
                  onChange={(e) => void patch(q.id, { assignedTeam: e.target.value as QueryTeam })}
                  className="rounded-md border border-line bg-white px-2 py-1 text-xs"
                >
                  <option value="" disabled>
                    Assign…
                  </option>
                  {TEAMS.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex items-center gap-1 text-xs text-muted">
                Status
                <select
                  aria-label={`Status for query ${q.id}`}
                  value={q.status}
                  onChange={(e) => void patch(q.id, { status: e.target.value as QueryStatus })}
                  className="rounded-md border border-line bg-white px-2 py-1 text-xs"
                >
                  {STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {s.replace('_', ' ')}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </Card>
        ))}
    </AdminScreen>
  );
}
