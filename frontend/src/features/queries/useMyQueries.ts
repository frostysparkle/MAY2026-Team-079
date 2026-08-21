import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, ApiClientError } from '@/api';
import type {
  Event,
  Hostel,
  Mess,
  MyEventRegistration,
  MyHostelResponse,
  MyMessResponse,
  MyWorkshopRegistration,
  QueryCreateRequest,
  QueryRecord,
  Workshop,
} from '@/api/types';
import { availableTargets, type QueryTarget } from './queries';

/**
 * A participant's own queries, and everything needed to raise another —
 * Stories 6.1 and 6.2.
 *
 * `GET /queries/mine` is the only fatal read: it is the story. The five
 * catalogue and placement reads that build the target list are all non-fatal, so
 * a participant whose hostel read fails can still ask about an event, and one
 * whose every catalogue fails can still reach the core team with a `general`
 * query. That is the difference between a degraded screen and a dead end.
 */
export interface MyQueriesState {
  queries: QueryRecord[];
  /** What this participant may raise a query against. */
  targets: QueryTarget[];
  /** Entity id → display name, for `targetLabel`. */
  names: Record<string, string>;
  loading: boolean;
  error: string | null;
  reload: () => void;
  /** Resolves to the new query id, or throws with the backend's own message. */
  raise: (req: QueryCreateRequest) => Promise<string>;
  reply: (queryId: string, body: string) => Promise<void>;
}

async function settled<T>(promise: Promise<T>, fallback: T): Promise<T> {
  try {
    return await promise;
  } catch {
    return fallback;
  }
}

interface Loaded {
  queries: QueryRecord[];
  events: Event[];
  workshops: Workshop[];
  registrations: MyEventRegistration[];
  workshopRegistrations: MyWorkshopRegistration[];
  hostels: Hostel[];
  messHalls: Mess[];
  hostel: MyHostelResponse | null;
  mess: MyMessResponse | null;
}

const EMPTY: Loaded = {
  queries: [],
  events: [],
  workshops: [],
  registrations: [],
  workshopRegistrations: [],
  hostels: [],
  messHalls: [],
  hostel: null,
  mess: null,
};

export function useMyQueries(): MyQueriesState {
  const [data, setData] = useState<Loaded>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Guards against a resolved request setting state after unmount, and against a
  // slow first load overwriting a faster reload.
  const generation = useRef(0);

  const load = useCallback(() => {
    const mine = ++generation.current;
    setLoading(true);
    setError(null);

    void (async () => {
      try {
        const queries = await api.myQueries();
        const [
          events,
          workshops,
          registrations,
          workshopRegistrations,
          hostels,
          messHalls,
          hostel,
          mess,
        ] = await Promise.all([
          settled(api.listEvents(), [] as Event[]),
          settled(api.listWorkshops(), [] as Workshop[]),
          settled(api.myEventRegistrations(), [] as MyEventRegistration[]),
          settled(api.myWorkshopRegistrations(), [] as MyWorkshopRegistration[]),
          settled(api.listHostels(), [] as Hostel[]),
          settled(api.listMess(), [] as Mess[]),
          settled(api.myHostel(), null),
          settled(api.myMess(), null),
        ]);

        if (generation.current !== mine) return;
        setData({
          queries,
          events,
          workshops,
          registrations,
          workshopRegistrations,
          hostels,
          messHalls,
          hostel,
          mess,
        });
      } catch (e) {
        if (generation.current !== mine) return;
        setError(e instanceof ApiClientError ? e.message : 'Could not load your queries.');
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

  const targets = useMemo(
    () =>
      availableTargets({
        registrations: data.registrations,
        events: data.events,
        workshopRegistrations: data.workshopRegistrations,
        workshops: data.workshops,
        hostel: data.hostel,
        hostels: data.hostels,
        mess: data.mess,
        messHalls: data.messHalls,
      }),
    [data],
  );

  const names = useMemo(() => {
    const map: Record<string, string> = {};
    for (const event of data.events) map[event.event_id] = event.name;
    for (const workshop of data.workshops) map[workshop.workshop_id] = workshop.name;
    for (const hostel of data.hostels) map[hostel.hostel_id] = hostel.name;
    for (const hall of data.messHalls) map[hall.mess_id] = hall.name;
    return map;
  }, [data]);

  const raise = useCallback(async (req: QueryCreateRequest) => {
    const created = await api.raiseQuery(req);
    // The response carries the whole stored row, so the list updates without a
    // second round trip — and without inventing a local shape that could drift
    // from what the server actually saved.
    setData((current) => ({ ...current, queries: [created.query, ...current.queries] }));
    return created.query_id;
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

  return {
    queries: data.queries,
    targets,
    names,
    loading,
    error,
    reload: load,
    raise,
    reply,
  };
}
