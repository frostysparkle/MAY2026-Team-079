import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, ApiClientError } from '@/api';
import type { Hostel, HostelStatisticsResponse } from '@/api/types';
import { isSuperAdmin } from '@/stores/authStore';
import {
  buildHostelRows,
  summariseHostels,
  type HostelRow,
  type HostelSummary,
} from './hostelOccupancy';

/**
 * Loads the hostel inventory and joins it with per-block occupancy.
 *
 * `GET /hostels` carries no occupancy, so the figures come from one
 * `GET /hostels/{id}/statistics` per block, fetched in parallel on load. That is
 * 22 requests for the seeded campus, which is the shape of the API rather than a
 * choice: there is no bulk occupancy endpoint. If the collection grows enough for
 * that to hurt, the fix belongs in the backend, not in a slower page.
 *
 * Statistics are Super-Admin-only. Rather than firing requests that are known to
 * 403, the fetch is skipped for anyone else and the occupancy columns render as
 * dashes — a per-block failure is also swallowed for the same reason, so one bad
 * block cannot blank the whole table.
 */
export function useHostelInventory() {
  const [hostels, setHostels] = useState<Hostel[] | null>(null);
  const [stats, setStats] = useState<Record<string, HostelStatisticsResponse>>({});
  const [statsLoading, setStatsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadStats = useCallback(async (list: Hostel[]) => {
    if (!isSuperAdmin()) return;
    setStatsLoading(true);
    try {
      const settled = await Promise.all(
        list.map(async (hostel) => {
          try {
            return [hostel.hostel_id, await api.hostelStatistics(hostel.hostel_id)] as const;
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
        .listHostels()
        .then((all) => {
          setHostels(all);
          setError(null);
          return loadStats(all);
        })
        .catch((e) =>
          setError(e instanceof ApiClientError ? e.message : 'Could not load hostels.'),
        ),
    [loadStats],
  );

  useEffect(() => {
    // Discarded on purpose: the effect must return a cleanup function or nothing,
    // never the promise.
    void load();
  }, [load]);

  /** Re-read one block's occupancy, e.g. after a scan or an allocation run. */
  const refreshOne = useCallback(async (hostelId: string) => {
    if (!isSuperAdmin()) return;
    try {
      const stat = await api.hostelStatistics(hostelId);
      setStats((prev) => ({ ...prev, [hostelId]: stat }));
    } catch {
      /* Leave the previous figure in place rather than blanking the row. */
    }
  }, []);

  const rows = useMemo(
    () => (hostels === null ? null : buildHostelRows(hostels, stats)),
    [hostels, stats],
  );

  const summary: HostelSummary | null = useMemo(
    () => (rows === null ? null : summariseHostels(rows)),
    [rows],
  );

  return {
    hostels,
    stats,
    rows,
    summary,
    error,
    /** True until both the list and its occupancy figures have settled. */
    loading: hostels === null || statsLoading,
    load,
    refreshOne,
  };
}

export type HostelInventory = ReturnType<typeof useHostelInventory>;
export type { HostelRow };
