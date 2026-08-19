/**
 * Loads everything the Accommodation & Mess screen needs from the real API, in
 * one pass.
 *
 * The two `my_*` reads are the screen's subject and are fatal if they fail. The
 * two catalogue reads are context — which blocks and halls exist — and are not:
 * a student whose room is allotted still gets their room shown when
 * `GET /hostels` happens to be down.
 *
 * `reload` is stable, so a caller can drive it from a timer — which is what
 * turns "reserved, awaiting allocation" into "Block C, room 104" without the
 * student reloading the page. Allocation is a batch the organisers run
 * (`POST /hostels/allocate`, `POST /mess/allocate`, both super-admin only), so
 * the placement lands on the server at a moment this screen has no other way to
 * hear about.
 */
import { useCallback, useEffect, useState } from 'react';
import { api, ApiClientError } from '@/api';
import type { Hostel, Mess, MyHostelResponse, MyMessResponse } from '@/api/types';

/** How often a caller should re-read while a paid-for facility is still unallocated. */
export const ALLOCATION_POLL_MS = 20_000;

export interface StayFacilities {
  hostel: MyHostelResponse | null;
  mess: MyMessResponse | null;
  /** Every block on the fest, for the "which blocks take you" note. May be empty. */
  hostels: Hostel[];
  /** Every hall on the fest, for the "which halls match your preference" note. */
  messHalls: Mess[];
}

type Status = 'loading' | 'ready' | 'error';

export function useStayFacilities() {
  const [data, setData] = useState<StayFacilities | null>(null);
  const [status, setStatus] = useState<Status>('loading');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [hostel, mess] = await Promise.all([api.myHostel(), api.myMess()]);
      const [hostels, messHalls] = await Promise.allSettled([api.listHostels(), api.listMess()]);
      setData({
        hostel,
        mess,
        hostels: hostels.status === 'fulfilled' ? hostels.value : [],
        messHalls: messHalls.status === 'fulfilled' ? messHalls.value : [],
      });
      setError(null);
      setStatus('ready');
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : 'Could not load your stay details.');
      setStatus('error');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return { data, status, error, reload: load };
}
