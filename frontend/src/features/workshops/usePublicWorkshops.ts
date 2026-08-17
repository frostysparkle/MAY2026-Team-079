import { useEffect, useMemo, useState } from 'react';
import { api } from '@/api';
import type { PublicWorkshopRecord } from '@/api/types';
import { publicWorkshopView, sortWorkshops, workshopDays, type WorkshopView } from './workshopView';

/**
 * The published workshop programme, read from `GET /workshops/public`.
 *
 * This is the pre-login workshops catalogue: it needs no token, because a
 * visitor browsing the fest has no account yet. Every workshop on the public
 * pages comes from here — the flyer list is no longer compiled into the app, it
 * is whatever the Super Admin has created.
 *
 * The result is cached at module scope so moving between the landing page, the
 * workshop grid, and a workshop page issues one request rather than one per
 * route. Mirrors `features/events/usePublicEvents.ts`.
 */

let cache: PublicWorkshopRecord[] | null = null;
let inflight: Promise<PublicWorkshopRecord[]> | null = null;

function loadPublicWorkshops(): Promise<PublicWorkshopRecord[]> {
  if (cache) return Promise.resolve(cache);
  inflight ??= api
    .listPublicWorkshops()
    .then((workshops) => {
      cache = workshops;
      return workshops;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/** Test seam: drop the cached programme so each case starts clean. */
export function __resetPublicWorkshopsCache(): void {
  cache = null;
  inflight = null;
}

export interface PublicWorkshopsState {
  views: WorkshopView[];
  loading: boolean;
  /** True once the request failed; the pages stay up with an empty programme. */
  failed: boolean;
}

export function usePublicWorkshops(): PublicWorkshopsState {
  // Seed from the cache so a warm navigation renders on the first paint.
  const [records, setRecords] = useState<PublicWorkshopRecord[]>(() => cache ?? []);
  const [loading, setLoading] = useState(cache === null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    // `loadPublicWorkshops` resolves from the cache when warm, so there is no
    // separate synchronous path — and therefore no setState in the effect body.
    let active = true;
    loadPublicWorkshops()
      .then((all) => {
        if (!active) return;
        setRecords(all);
        setFailed(false);
      })
      .catch(() => {
        if (!active) return;
        setRecords([]);
        setFailed(true);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  const views = useMemo(() => sortWorkshops(records.map(publicWorkshopView)), [records]);

  return { views, loading, failed };
}

/** One workshop from the published programme. */
export function usePublicWorkshop(workshopId: string | undefined): {
  view: WorkshopView | undefined;
  loading: boolean;
} {
  const { views, loading } = usePublicWorkshops();
  const view = useMemo(() => views.find((w) => w.id === workshopId), [views, workshopId]);
  return { view, loading };
}

/**
 * The days the programme runs on, and how many workshops sit on each.
 *
 * `null` while loading, so callers can leave a count out rather than announce a
 * misleading "0".
 */
export function usePublicWorkshopCounts(): {
  days: ReturnType<typeof workshopDays> | null;
  total: number | null;
} {
  const { views, loading } = usePublicWorkshops();
  return useMemo(
    () =>
      loading ? { days: null, total: null } : { days: workshopDays(views), total: views.length },
    [views, loading],
  );
}
