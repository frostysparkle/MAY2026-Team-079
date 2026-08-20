import { useCallback, useEffect, useState } from 'react';
import { api } from '@/api';
import type { EventCapacityCountsResponse } from '@/api/types';

/**
 * The live counts behind an event's crowd signal — Story 3.3.
 *
 * The workshop equivalent (`useLiveSeats`) streams remaining seats over SSE
 * because a workshop sells a fixed number of places and the last one can be sold
 * twice. An event does not sell places, so there is nothing to race: this reads
 * once on open and again when the caller asks, rather than holding a connection
 * open per event page.
 *
 * `GET /events/{id}/capacity` returns two integers and no identities, which is
 * what makes it readable by a participant at all — every other count of how full
 * an event is returns the roster and is staff-gated. See the endpoint's own
 * docstring for why it is safe to expose.
 *
 * Failure is silent and yields `null`. A crowd signal is a convenience on a page
 * whose real job is showing the event and taking a registration; it must never
 * turn a readable event page into an error state.
 *
 * Deliberately holds the raw response rather than the derived readout: deriving
 * needs the published capacity, which arrives with the event on a separate
 * request, and depending on it here would refetch the counts the moment the
 * event landed.
 */
export function useEventCrowd(eventId: string) {
  const [counts, setCounts] = useState<EventCapacityCountsResponse | null>(null);

  const load = useCallback(() => {
    if (!eventId) return Promise.resolve();
    return api
      .eventCapacityCounts(eventId)
      .then(setCounts)
      .catch(() => setCounts(null));
  }, [eventId]);

  useEffect(() => {
    // Discarded on purpose: an effect must return a cleanup function or nothing.
    void load();
  }, [load]);

  return { counts, reload: load };
}
