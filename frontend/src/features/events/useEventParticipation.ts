import { useCallback, useEffect, useState } from 'react';
import { api, ApiClientError } from '@/api';
import type { EventParticipationResponse } from '@/api/types';

/**
 * One event's registration roster, from `GET /events/{event_id}/participation`.
 *
 * Extracted from `EventParticipationPage` when the staff dashboard began showing
 * the same roster inline: two screens reading one endpoint, and the loading and
 * error handling around it is the part that is easy to get subtly different.
 *
 * The endpoint authorises any `event_team` member (`is_event_team` in
 * `view_participation`), which is why a volunteer's dashboard can call it at all.
 * It scopes what comes back: a UHC member sees only their own house, so a short
 * list is not necessarily a bug — `EventParticipationView` carries the warning
 * that says so.
 *
 * The event id is stored *with* the response rather than beside it, so a reply can
 * never be shown under the wrong event's name. A response that arrives after the
 * caller has moved on, or out of order behind a slower earlier one, fails the
 * `loaded.eventId === eventId` test and reads as still loading. That also keeps
 * every `setState` inside a promise callback instead of the effect body, which is
 * what `react-hooks/set-state-in-effect` is about.
 *
 * `reload` is returned for callers that change the roster and need it re-read;
 * nothing does yet, and it costs nothing to expose from here rather than adding it
 * later in two places.
 */
interface LoadedParticipation {
  eventId: string;
  data: EventParticipationResponse | null;
  error: string | null;
}

export function useEventParticipation(eventId: string): {
  data: EventParticipationResponse | null;
  error: string | null;
  reload: () => void;
} {
  const [loaded, setLoaded] = useState<LoadedParticipation>({
    eventId: '',
    data: null,
    error: null,
  });

  const load = useCallback(() => {
    if (!eventId) return;
    api
      .eventParticipation(eventId)
      .then((data) => setLoaded({ eventId, data, error: null }))
      .catch((e) =>
        setLoaded({
          eventId,
          data: null,
          error: e instanceof ApiClientError ? e.message : 'Could not load participation.',
        }),
      );
  }, [eventId]);

  useEffect(() => {
    load();
  }, [load]);

  const fresh = loaded.eventId === eventId;
  return {
    data: fresh ? loaded.data : null,
    error: fresh ? loaded.error : null,
    reload: load,
  };
}
