import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, ApiClientError } from '@/api';
import type { EventLogRow, WorkshopLogRow } from '@/api/types';
import {
  fromAuditLogs,
  fromEventLogs,
  fromWorkshopLogs,
  peopleNamesFrom,
  sortLogsNewestFirst,
  type LogDomain,
  type LogEntry,
  type LogNames,
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

/**
 * A domain's own scan rows, still unnormalised.
 *
 * Discriminated so the rows keep their row type until the adapter is chosen, and
 * `ok` travels with them rather than being inferred from an empty list — an event
 * with no scans yet and an event whose scans could not be read are different
 * things and the view says so.
 */
type ScanRows =
  | { kind: 'events'; rows: EventLogRow[]; ok: boolean }
  | { kind: 'workshops'; rows: WorkshopLogRow[]; ok: boolean }
  | { kind: 'none'; rows: []; ok: true };

export function useEntityLogs(domain: LogDomain, entityId: string, entityName?: string | null) {
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

    /**
     * Scan rows are fetched in parallel but normalised *after* the trail, because
     * the trail is what carries people's names. `event_logs` and `workshop_logs`
     * store bare ids, and the same volunteers and participants appear in both, so
     * pooling the trail's names is what lets a scan row say who was scanned
     * without a second round of lookups.
     *
     * `ok` rides along rather than being set from a catch, so a failure here
     * cannot blank the audit half and the "some records could not be read" flag is
     * set once, with everything else.
     */
    const scanPromise: Promise<ScanRows> =
      domain === 'events'
        ? api
            .eventLogs(entityId)
            .then((res): ScanRows => ({ kind: 'events', rows: res.logs, ok: true }))
            .catch((): ScanRows => ({ kind: 'events', rows: [], ok: false }))
        : domain === 'workshops'
          ? api
              .workshopLogs(entityId)
              .then((res): ScanRows => ({ kind: 'workshops', rows: res.logs, ok: true }))
              .catch((): ScanRows => ({ kind: 'workshops', rows: [], ok: false }))
          : Promise.resolve<ScanRows>({ kind: 'none', rows: [], ok: true });

    return Promise.all([api.auditLogs(LOG_LIMIT, { target_id: entityId }), scanPromise])
      .then(([audit, scan]) => {
        // Every row on this page belongs to this one entity, but the two sources
        // key it differently — the trail by its readable id, the scan collections
        // by its ObjectId — so the name is registered under whichever ids appear.
        const entities: Record<string, string> = {};
        if (entityName) {
          entities[entityId] = entityName;
          for (const row of scan.rows) {
            const id = 'event_id' in row ? row.event_id : row.workshop_id;
            if (id) entities[id] = entityName;
          }
        }

        const names: LogNames = { entities, people: peopleNamesFrom(audit) };
        const scans =
          scan.kind === 'events'
            ? fromEventLogs(scan.rows, names)
            : scan.kind === 'workshops'
              ? fromWorkshopLogs(scan.rows, names)
              : [];

        setEntries(sortLogsNewestFirst([...fromAuditLogs(audit, names), ...scans]));
        setPartial(!scan.ok);
        setError(null);
      })
      .catch((e) => setError(e instanceof ApiClientError ? e.message : 'Could not load the logs.'));
  }, [domain, entityId, entityName]);

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
