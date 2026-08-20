import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, ApiClientError } from '@/api';
import {
  fromAuditLogs,
  fromEventLogs,
  fromWorkshopLogs,
  sortLogsNewestFirst,
  type LogDomain,
  type LogEntry,
} from './logModel';

/**
 * Every log record for one entity, from all of the places the system keeps them.
 *
 * Two fetches at most, chosen by domain:
 *
 *   - the audit trail narrowed by `target_id`, which every domain needs — and for
 *     mess halls and hostel blocks is the *only* source, since meal scans and
 *     entry/exit are recorded nowhere else
 *   - the domain's own scan collection, for events and workshops, whose
 *     attendance rows never reach the audit trail at all
 *
 * The `target_id` filter is applied server-side deliberately. `limit` is applied
 * by Mongo before any client-side filter could run, so sifting a capped trail in
 * the browser would silently lose an entity's older entries.
 */

/** Generous, because this is one entity's history rather than the whole trail. */
const LOG_LIMIT = 500;

/** Shared empty result, so `entries` keeps a stable identity while loading. */
const NO_ENTRIES: LogEntry[] = [];

export function useEntityLogs(domain: LogDomain, entityId: string) {
  const [entries, setEntries] = useState<LogEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Set when the scan collection could not be read but the trail could. */
  const [partial, setPartial] = useState(false);

  /**
   * Written as a promise chain with no synchronous body, so nothing runs during
   * render when this is used as the mount effect below.
   *
   * The scan half resolves to `[entries, ok]` rather than setting state from its
   * own catch: a failure there must not blank the audit half, and `ok` lets the
   * "some records could not be read" flag be set once, with everything else.
   */
  const load = useCallback(() => {
    if (!entityId) return Promise.resolve();

    const scanPromise: Promise<[LogEntry[], boolean]> =
      domain === 'events'
        ? api
            .eventLogs(entityId)
            .then((res): [LogEntry[], boolean] => [fromEventLogs(res.logs), true])
            .catch((): [LogEntry[], boolean] => [[], false])
        : domain === 'workshops'
          ? api
              .workshopLogs(entityId)
              .then((res): [LogEntry[], boolean] => [fromWorkshopLogs(res.logs), true])
              .catch((): [LogEntry[], boolean] => [[], false])
          : Promise.resolve<[LogEntry[], boolean]>([[], true]);

    return Promise.all([api.auditLogs(LOG_LIMIT, { target_id: entityId }), scanPromise])
      .then(([audit, [scans, scansOk]]) => {
        setEntries(sortLogsNewestFirst([...fromAuditLogs(audit), ...scans]));
        setPartial(!scansOk);
        setError(null);
      })
      .catch((e) => setError(e instanceof ApiClientError ? e.message : 'Could not load the logs.'));
  }, [domain, entityId]);

  useEffect(() => {
    // Discarded on purpose: the effect must return a cleanup function or nothing.
    void load();
  }, [load]);

  /** The action vocabulary actually present, for building filter options. */
  const actions = useMemo(
    () => [...new Set((entries ?? []).map((e) => e.action))].sort(),
    [entries],
  );

  return {
    // A stable array rather than `?? []` at each call site, which would hand
    // consumers a fresh reference every render and defeat their own memoisation.
    entries: entries ?? NO_ENTRIES,
    actions,
    error,
    partial,
    loading: entries === null,
    load,
  };
}
