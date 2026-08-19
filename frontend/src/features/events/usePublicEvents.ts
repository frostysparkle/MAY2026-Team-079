import { useEffect, useMemo, useState } from 'react';
import { api } from '@/api';
import type { PublicEventRecord } from '@/api/types';
import { categorySlugForEventType, publicEventsForCategory, type EventView } from './eventView';
import type { PublicEventCategorySlug } from './publicEvents';

/**
 * The published festival programme, read from `GET /events/public`.
 *
 * This is the pre-login events catalogue: it needs no token, because a visitor
 * browsing the fest has no account yet. Every event on the public pages comes
 * from here — the catalogue is no longer compiled into the app, it is whatever
 * the Super Admin has created.
 *
 * The result is cached at module scope so moving between the landing page, a
 * category page, and an event page issues one request rather than one per route.
 */

let cache: PublicEventRecord[] | null = null;
let inflight: Promise<PublicEventRecord[]> | null = null;

function loadPublicEvents(): Promise<PublicEventRecord[]> {
  if (cache) return Promise.resolve(cache);
  inflight ??= api
    .listPublicEvents()
    .then((events) => {
      cache = events;
      return events;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/** Test seam: drop the cached programme so each case starts clean. */
export function __resetPublicEventsCache(): void {
  cache = null;
  inflight = null;
}

export interface PublicEventsState {
  events: PublicEventRecord[];
  loading: boolean;
  /** True once the request failed; the pages stay up with an empty programme. */
  failed: boolean;
}

export function usePublicEvents(): PublicEventsState {
  // Seed from the cache so a warm navigation renders the programme on the first
  // paint, with no loading flash.
  const [events, setEvents] = useState<PublicEventRecord[]>(() => cache ?? []);
  const [loading, setLoading] = useState(cache === null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    // `loadPublicEvents` resolves from the cache when it is warm, so there is no
    // separate synchronous path here — and therefore no setState during the
    // effect body, which would cascade a render.
    let active = true;
    loadPublicEvents()
      .then((all) => {
        if (!active) return;
        setEvents(all);
        setFailed(false);
      })
      .catch(() => {
        if (!active) return;
        setEvents([]);
        setFailed(true);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  return { events, loading, failed };
}

/** The programme for one category page, as renderable views. */
export function usePublicCategoryEvents(slug: PublicEventCategorySlug | undefined): {
  views: EventView[];
  loading: boolean;
  failed: boolean;
} {
  const { events, loading, failed } = usePublicEvents();
  const views = useMemo(() => (slug ? publicEventsForCategory(events, slug) : []), [events, slug]);
  return { views, loading, failed };
}

/**
 * How many published events sit in each category.
 *
 * `null` while the programme is still loading, so callers can leave the count
 * out rather than announce a misleading "0 events".
 */
export function usePublicEventCounts(): {
  counts: Record<string, number> | null;
  total: number | null;
} {
  const { events, loading } = usePublicEvents();

  return useMemo(() => {
    if (loading) return { counts: null, total: null };

    const counts: Record<string, number> = {};
    for (const event of events) {
      const slug = categorySlugForEventType(event.event_type);
      if (!slug) continue; // `others` has no public category page
      counts[slug] = (counts[slug] ?? 0) + 1;
    }

    const total = Object.values(counts).reduce((sum, n) => sum + n, 0);
    return { counts, total };
  }, [events, loading]);
}
