import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, ApiClientError } from '@/api';
import type { Mess, MessStatisticsResponse } from '@/api/types';
import { isSuperAdmin } from '@/stores/authStore';
import { buildMessRows, summariseMess, type MessRow, type MessSummary } from './messOccupancy';

/**
 * Loads the mess inventory and joins it with per-hall occupancy.
 *
 * `GET /mess` carries no occupancy, so the figures come from one
 * `GET /mess/{id}/statistics` per hall, fetched in parallel on load. That is the
 * shape of the API rather than a choice: there is no bulk occupancy endpoint.
 *
 * Statistics are Super-Admin-only. Rather than firing requests that are known to
 * 403, the fetch is skipped for anyone else and the occupancy columns render as
 * dashes — a per-hall failure is also swallowed for the same reason, so one bad
 * hall cannot blank the whole table.
 *
 * The hostel equivalent is `features/hostels/useHostelInventory`. The two are
 * deliberately separate hooks over separate endpoints; only the occupancy
 * arithmetic they share is factored out, into `features/occupancy`.
 */
export function useMessInventory() {
  const [halls, setHalls] = useState<Mess[] | null>(null);
  const [stats, setStats] = useState<Record<string, MessStatisticsResponse>>({});
  const [statsLoading, setStatsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadStats = useCallback(async (list: Mess[]) => {
    if (!isSuperAdmin()) return;
    setStatsLoading(true);
    try {
      const settled = await Promise.all(
        list.map(async (hall) => {
          try {
            return [hall.mess_id, await api.messStatistics(hall.mess_id)] as const;
          } catch {
            return null;
          }
        }),
      );
      setStats(Object.fromEntries(settled.filter((e): e is NonNullable<typeof e> => e !== null)));
    } finally {
      setStatsLoading(false);
    }
  }, []);

  // Written as a promise chain rather than an `async` body so that nothing here
  // runs synchronously when it is used as the mount effect below, and so that
  // clearing the error happens on success rather than up front.
  const load = useCallback(
    () =>
      api
        .listMess()
        .then((all) => {
          setHalls(all);
          setError(null);
          return loadStats(all);
        })
        .catch((e) => setError(e instanceof ApiClientError ? e.message : 'Could not load mess.')),
    [loadStats],
  );

  useEffect(() => {
    // Discarded on purpose: the effect must return a cleanup function or nothing,
    // never the promise.
    void load();
  }, [load]);

  /** Re-read one hall's occupancy, e.g. after an allocation run. */
  const refreshOne = useCallback(async (messId: string) => {
    if (!isSuperAdmin()) return;
    try {
      const stat = await api.messStatistics(messId);
      setStats((prev) => ({ ...prev, [messId]: stat }));
    } catch {
      /* Leave the previous figure in place rather than blanking the row. */
    }
  }, []);

  const rows = useMemo(() => (halls === null ? null : buildMessRows(halls, stats)), [halls, stats]);

  const summary: MessSummary | null = useMemo(
    () => (rows === null ? null : summariseMess(rows)),
    [rows],
  );

  return {
    halls,
    stats,
    rows,
    summary,
    error,
    /** True until both the list and its occupancy figures have settled. */
    loading: halls === null || statsLoading,
    load,
    refreshOne,
  };
}

export type MessInventory = ReturnType<typeof useMessInventory>;
export type { MessRow };
