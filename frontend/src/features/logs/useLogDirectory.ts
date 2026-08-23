import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, ApiClientError } from '@/api';
import type { AuditLogEntry, AuditLogSummary } from '@/api/types';
import {
  domainOfAction,
  LOG_DOMAINS,
  peopleNamesFrom,
  type EntityNames,
  type LogDomain,
  type LogNames,
} from './logModel';

/**
 * The directory behind the entity browser: every event, workshop, mess hall, and
 * hostel block, each with how much activity has been recorded against it.
 *
 * Counts come from one pass over the audit trail rather than a request per entity.
 * With 50+ events and 57 workshops, a per-entity fetch would be hundreds of calls
 * to render a list — the per-entity detail view is where the full picture is
 * assembled, and that is fetched only for the one entity being opened.
 *
 * A consequence worth knowing: these counts cover the audit trail only, so event
 * and workshop *attendance* scans are not included here. The counts are a "has
 * anything happened?" signal for navigation, and the detail view is authoritative.
 */

/**
 * How many rows to pull for the table and the per-entity activity signal.
 *
 * A cap on *rows shown*, not on the figures beside them. Every count this hook
 * publishes as a total now comes from `GET /audit-logs/summary`, which counts
 * server-side over the whole trail — so a fest with more history than this limit
 * no longer reports the limit as its total.
 *
 * The default, not the only option: `GET /audit-logs?limit=` takes any value **up
 * to `backend/models.py`'s `PAGE_LIMIT_MAX` (500)** — a request above that is
 * rejected outright (422), not silently truncated — and the screen offers the
 * choices below. `limit` matters because it is applied *before* any client-side
 * filter could run, so searching a fest with more history than the window
 * searches only the window.
 */
export const TRAIL_LIMIT = 500;

/** Row windows the audit screen offers, smallest first. Capped at the server's
 * hard limit (`backend/models.py: PAGE_LIMIT_MAX`) — anything above 500 is a
 * 422, not a bigger page. */
export const TRAIL_LIMIT_OPTIONS = [100, 200, 500] as const;

export interface LogDirectoryEntity {
  id: string;
  name: string;
  domain: LogDomain;
  /** One line of context, e.g. an event's type or a hall's capacity. */
  meta: string;
  /**
   * Audit entries recorded against this entity, within the fetched window.
   *
   * A floor, not a total — it is counted from the `TRAIL_LIMIT` rows this hook
   * holds. Exact per-entity counts would need one aggregation per entity, and this
   * figure exists to answer "has anything happened here?" for navigation. Check
   * `truncated` before presenting it as a count.
   */
  auditCount: number;
  /** Timestamp of the most recent audit entry, or null when there is none. */
  lastActivity: string | null;
}

export function useLogDirectory(limit: number = TRAIL_LIMIT) {
  const [trail, setTrail] = useState<AuditLogEntry[] | null>(null);
  const [summary, setSummary] = useState<AuditLogSummary | null>(null);
  const [entities, setEntities] = useState<LogDirectoryEntity[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    () =>
      Promise.all([
        api.auditLogs(limit),
        // Exact counts over the whole trail. Non-fatal on its own: losing it drops
        // the figures back to counting the fetched page, which is what they used
        // to do, rather than failing the screen.
        api.auditLogSummary({}).catch(() => null),
        api.listEvents(),
        api.listWorkshops(),
        api.listMess(),
        api.listHostels(),
      ])
        .then(([logs, trailSummary, events, workshops, mess, hostels]) => {
          const byTarget = new Map<string, { count: number; last: string }>();
          for (const log of logs) {
            if (!log.target_id) continue;
            const seen = byTarget.get(log.target_id);
            byTarget.set(log.target_id, {
              count: (seen?.count ?? 0) + 1,
              // The trail arrives newest-first, so the first sighting is the latest.
              last: seen?.last ?? log.timestamp,
            });
          }

          const build = (
            domain: LogDomain,
            rows: { id: string; name: string; meta: string }[],
          ): LogDirectoryEntity[] =>
            rows.map((row) => {
              const seen = byTarget.get(row.id);
              return {
                ...row,
                domain,
                auditCount: seen?.count ?? 0,
                lastActivity: seen?.last ?? null,
              };
            });

          setEntities([
            ...build(
              'events',
              events.map((e) => ({
                id: e.event_id,
                name: e.name,
                meta: e.event_type,
              })),
            ),
            ...build(
              'workshops',
              workshops.map((w) => ({
                id: w.workshop_id,
                name: w.name,
                meta: w.venue || w.slot_id,
              })),
            ),
            ...build(
              'mess',
              mess.map((m) => ({
                id: m.mess_id,
                name: m.name,
                meta: `${m.capacity} seats`,
              })),
            ),
            ...build(
              'hostels',
              hostels.map((h) => ({
                id: h.hostel_id,
                name: h.name,
                meta: `${h.capacity} beds`,
              })),
            ),
          ]);
          setTrail(logs);
          setSummary(trailSummary);
          setError(null);
        })
        .catch((e) =>
          setError(e instanceof ApiClientError ? e.message : 'Could not load the audit trail.'),
        ),
    // Re-reads when the window changes, which is the point of making it a
    // parameter — widening it has to fetch the wider page.
    [limit],
  );

  useEffect(() => {
    // Discarded on purpose: the effect must return a cleanup function or nothing.
    void load();
  }, [load]);

  /**
   * The names a log row needs, from what this hook already fetched.
   *
   * The entity lists are here for the browser below; reusing them to name a row's
   * target costs nothing and is the difference between a row reading "Mess hall 2"
   * and `MESS_PROBE2_413179`. People's names ride along on the trail itself.
   */
  const names = useMemo<LogNames>(() => {
    const byId: Record<string, string> = {};
    for (const entity of entities ?? []) byId[entity.id] = entity.name;
    return { entities: byId as EntityNames, people: peopleNamesFrom(trail ?? []) };
  }, [trail, entities]);

  /**
   * Recorded actions per domain.
   *
   * Derived from the summary's `by_action`, which is counted server-side over the
   * whole trail, so these are totals. The previous pass over `trail` could only
   * ever count the fetched page, which made every one of these cards report a
   * share of the newest 1,000 rows under a label that read like a fest total.
   *
   * Falls back to that pass when the summary is unavailable — the figures then
   * become floors again, which `exact` below reports so the UI can say so.
   */
  const perDomain = useMemo(() => {
    const counts: Record<LogDomain, number> = { events: 0, workshops: 0, mess: 0, hostels: 0 };

    if (summary) {
      for (const [action, count] of Object.entries(summary.by_action)) {
        const domain = domainOfAction(action);
        if (domain) counts[domain] += count;
      }
    } else {
      for (const log of trail ?? []) {
        const domain = domainOfAction(log.action);
        if (domain) counts[domain] += 1;
      }
    }

    return LOG_DOMAINS.map((domain) => ({ domain, count: counts[domain] }));
  }, [summary, trail]);

  return {
    trail,
    entities,
    /** Pass to `fromAuditLogs` so rows name people and places, not ids. */
    names,
    perDomain,
    /** Exact counts over the whole trail, or `null` if that call failed. */
    summary,
    /**
     * Recorded actions across the whole trail. Exact when the summary loaded;
     * otherwise the size of the fetched page, which is a floor.
     */
    total: summary?.total ?? trail?.length ?? 0,
    /** Whether `total` and `perDomain` are fest-wide totals rather than floors. */
    exact: summary !== null,
    /** The table is showing a capped slice of a longer trail. */
    truncated: (trail?.length ?? 0) >= limit,
    /** The window that produced `trail`, so a screen can offer to widen it. */
    limit,
    error,
    loading: entities === null,
    load,
  };
}
