import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiClientError } from '@/api';
import type { Announcement, AnnouncementCreateRequest } from '@/api/types';
import { sortNewestFirst } from './announcements';

/**
 * One event's announcements — Story 8.2.
 *
 * `GET /events/{id}/announcements` is readable by a registered participant,
 * the event's own team, or a Super Admin (`_may_read_announcements` in
 * `backend/routers/events.py`); everyone else gets a 403. Rather than treat
 * that as a screen-level failure, an unauthorised read degrades to an empty,
 * silent list — the same way `EventCrowdCard`'s data degrades on the public
 * brochure. A page that is not entitled to announcements should not show an
 * error banner about it; it should simply not show announcements, the way it
 * already does for a visitor with no token at all.
 *
 * `publish` is left to throw on failure (a 403 from `POST` means "you are not
 * this event's Event Head", which is worth surfacing, unlike a 403 on read).
 */
export interface EventAnnouncementsState {
  announcements: Announcement[];
  loading: boolean;
  /** Set only when the *read* failed for a reason other than "not authorised". */
  error: string | null;
  reload: () => void;
  /** Resolves to the new announcement, or throws with the backend's own message. */
  publish: (req: AnnouncementCreateRequest) => Promise<Announcement>;
}

export function useEventAnnouncements(eventId: string): EventAnnouncementsState {
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);

  const load = useCallback(() => {
    if (!eventId) {
      setLoading(false);
      return;
    }
    const mine = ++generation.current;
    setLoading(true);
    setError(null);

    void api
      .listAnnouncements(eventId)
      .then((rows) => {
        if (generation.current !== mine) return;
        setAnnouncements(sortNewestFirst(rows));
      })
      .catch((e) => {
        if (generation.current !== mine) return;
        // A 403 means this caller simply cannot read this event's announcements
        // (not registered, not on its team, not a Super Admin) — not a fetch
        // failure. Degrade to "nothing to show" rather than an error banner on a
        // page whose main content loaded fine.
        if (e instanceof ApiClientError && e.status === 403) {
          setAnnouncements([]);
          return;
        }
        setError(e instanceof ApiClientError ? e.message : 'Could not load announcements.');
      })
      .finally(() => {
        if (generation.current === mine) setLoading(false);
      });
  }, [eventId]);

  useEffect(() => {
    load();
    return () => {
      generation.current += 1;
    };
  }, [load]);

  const publish = useCallback(
    async (req: AnnouncementCreateRequest) => {
      const result = await api.createAnnouncement(eventId, req);
      setAnnouncements((current) => sortNewestFirst([result.announcement, ...current]));
      return result.announcement;
    },
    [eventId],
  );

  return { announcements, loading, error, reload: load, publish };
}
