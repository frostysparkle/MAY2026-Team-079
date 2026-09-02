import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, ApiClientError } from '@/api';
import type { Event, Hostel, Mess, QueryRecord, QueryUpdateRequest, Workshop } from '@/api/types';
import { sortForDuty } from './queries';

/**
 * The queries this staff member is answerable for — Stories 6.3 and 6.4.
 *
 * The scoping is **not** done here. `GET /queries` already returns only the
 * blocks, halls, events, and workshops the caller is named on a team for, plus
 * anything assigned to them by name; a Super Admin gets the fest. Filtering
 * again in the client would be a second implementation of a rule that only means
 * something on the server, and the two would eventually disagree.
 *
 * The catalogue reads are non-fatal and exist only to turn ids into names, so a
 * console whose events list fails still shows the queue with raw ids rather than
 * showing nothing.
 */
export interface QueryQueueState {
  queries: QueryRecord[];
  /** Entity id → display name. */
  names: Record<string, string>;
  loading: boolean;
  error: string | null;
  reload: () => void;
  update: (queryId: string, req: QueryUpdateRequest) => Promise<void>;
  reply: (queryId: string, body: string) => Promise<void>;
}

async function settled<T>(promise: Promise<T>, fallback: T): Promise<T> {
  try {
    return await promise;
  } catch {
    return fallback;
  }
}

/**
 * Whether a failed queue load is "you have no desk here" rather than "the
 * screen is broken". `GET /queries` hard-refuses staff outside the query team
 * and Super Admins (`403 Not authorized to access queries`) — there is no
 * per-entity scope left to fall back to an empty result with, by explicit
 * backend decision. An event-team volunteer is on nobody's query team, so every
 * visit to Support showed them a red "Could not load the queue" for a queue
 * they can never be part of; the same red state is correct for a genuine
 * outage, and the two are only distinguishable by the status code. A 403 means
 * the empty shelf, not the outage.
 */
async function settledQueries(): Promise<QueryRecord[]> {
  try {
    return await api.listQueries();
  } catch (e) {
    if (e instanceof ApiClientError && e.status === 403) return [];
    throw e;
  }
}

interface Loaded {
  queries: QueryRecord[];
  events: Event[];
  workshops: Workshop[];
  hostels: Hostel[];
  messHalls: Mess[];
}

const EMPTY: Loaded = { queries: [], events: [], workshops: [], hostels: [], messHalls: [] };

export function useQueryQueue(): QueryQueueState {
  const [data, setData] = useState<Loaded>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);

  const load = useCallback(() => {
    const mine = ++generation.current;
    setLoading(true);
    setError(null);

    void (async () => {
      try {
        const queries = await settledQueries();
        const [events, workshops, hostels, messHalls] = await Promise.all([
          settled(api.listEvents(), [] as Event[]),
          settled(api.listWorkshops(), [] as Workshop[]),
          settled(api.listHostels(), [] as Hostel[]),
          settled(api.listMess(), [] as Mess[]),
        ]);

        if (generation.current !== mine) return;
        setData({ queries, events, workshops, hostels, messHalls });
      } catch (e) {
        if (generation.current !== mine) return;
        setError(e instanceof ApiClientError ? e.message : 'Could not load the query queue.');
      } finally {
        if (generation.current === mine) setLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    load();
    return () => {
      generation.current += 1;
    };
  }, [load]);

  const names = useMemo(() => {
    const map: Record<string, string> = {};
    for (const event of data.events) map[event.event_id] = event.name;
    for (const workshop of data.workshops) map[workshop.workshop_id] = workshop.name;
    for (const hostel of data.hostels) map[hostel.hostel_id] = hostel.name;
    for (const hall of data.messHalls) map[hall.mess_id] = hall.name;
    return map;
  }, [data]);

  const update = useCallback(async (queryId: string, req: QueryUpdateRequest) => {
    const result = await api.updateQuery(queryId, req);
    // The response is the whole stored row, so the implied status change —
    // naming an assignee sets `assigned`, resolving stamps `resolved_at` — lands
    // in the client exactly as the server recorded it, rather than being guessed.
    setData((current) => ({
      ...current,
      queries: current.queries.map((query) => (query.query_id === queryId ? result.query : query)),
    }));
  }, []);

  const reply = useCallback(async (queryId: string, body: string) => {
    const added = await api.replyToQuery(queryId, { body });
    setData((current) => ({
      ...current,
      queries: current.queries.map((query) =>
        query.query_id === queryId ? { ...query, replies: [...query.replies, added.reply] } : query,
      ),
    }));
  }, []);

  // Sorted for work rather than for recency: unanswered at the top, whatever
  // their age. Done here rather than in the page so both the console and any
  // future board read the same order.
  const queries = useMemo(() => sortForDuty(data.queries), [data.queries]);

  return { queries, names, loading, error, reload: load, update, reply };
}
