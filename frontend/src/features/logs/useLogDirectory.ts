import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, ApiClientError } from '@/api';
import type { AuditLogEntry } from '@/api/types';
import { domainOfAction, LOG_DOMAINS, type LogDomain } from './logModel';

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

/** High enough to cover the whole trail for a festival-sized dataset. */
const TRAIL_LIMIT = 1000;

export interface LogDirectoryEntity {
  id: string;
  name: string;
  domain: LogDomain;
  /** One line of context, e.g. an event's type or a hall's capacity. */
  meta: string;
  /** Audit entries recorded against this entity. */
  auditCount: number;
  /** Timestamp of the most recent audit entry, or null when there is none. */
  lastActivity: string | null;
}

export function useLogDirectory() {
  const [trail, setTrail] = useState<AuditLogEntry[] | null>(null);
  const [entities, setEntities] = useState<LogDirectoryEntity[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    () =>
      Promise.all([
        api.auditLogs(TRAIL_LIMIT),
        api.listEvents(),
        api.listWorkshops(),
        api.listMess(),
        api.listHostels(),
      ])
        .then(([logs, events, workshops, mess, hostels]) => {
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
          setError(null);
        })
        .catch((e) =>
          setError(e instanceof ApiClientError ? e.message : 'Could not load the audit trail.'),
        ),
    [],
  );

  useEffect(() => {
    // Discarded on purpose: the effect must return a cleanup function or nothing.
    void load();
  }, [load]);

  /** Recorded actions per domain, for the summary figures. */
  const perDomain = useMemo(() => {
    const counts: Record<LogDomain, number> = { events: 0, workshops: 0, mess: 0, hostels: 0 };
    for (const log of trail ?? []) {
      const domain = domainOfAction(log.action);
      if (domain) counts[domain] += 1;
    }
    return LOG_DOMAINS.map((domain) => ({ domain, count: counts[domain] }));
  }, [trail]);

  return {
    trail,
    entities,
    perDomain,
    error,
    loading: entities === null,
    load,
  };
}
