import { useCallback, useEffect, useState } from 'react';
import { api, ApiClientError } from '@/api';
import type { DutyContact } from '@/features/stay/dutyContacts';
import { hostelContacts, messContacts } from '@/features/stay/dutyContacts';
import {
  draftToRequest,
  facilityKey,
  reportableFacilities,
  type ReportDraft,
  type ReportableFacility,
} from './issues';
import type { Issue } from '@/api/types';

/**
 * The participant's own side of Story 5.4: where they may file, what they have
 * filed, and who to ring instead when it cannot wait.
 *
 * Four reads, and only one of them is allowed to sink the screen:
 *
 *   1. `GET /issues/mine` — their reports. A failure here is a real failure,
 *      because the screen's whole second half is this list.
 *   2. `GET /hostels/my_hostel` and `GET /mess/my_mess` — where they are placed.
 *      These decide what the form may offer, since `POST /issues` refuses a
 *      facility the caller is not in. A participant with neither placement is not
 *      an error: it is somebody who took no bed and no hall, and the screen says
 *      so.
 *   3. `GET /hostels` and `GET /mess` — names only, and entirely optional. A
 *      report filed against `HSTL_07` is filed correctly whether or not we can
 *      call it "Ganga Block", so these are allowed to fail quietly and the id is
 *      shown instead.
 *
 * The duty contacts are keyed by `facilityKey` rather than by bare id so a hostel
 * and a hall that happen to share an id cannot collide.
 */
export interface MyIssuesState {
  facilities: ReportableFacility[];
  issues: Issue[];
  /** `hostel:GANGA` → the people on duty there. */
  contacts: Record<string, DutyContact[]>;
  status: 'loading' | 'ready' | 'error';
  error: string | null;
  reload: () => Promise<void>;
  /** Files the draft and returns the new `issue_id`. Throws on refusal. */
  report: (draft: ReportDraft) => Promise<string>;
}

export function useMyIssues(): MyIssuesState {
  const [facilities, setFacilities] = useState<ReportableFacility[]>([]);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [contacts, setContacts] = useState<Record<string, DutyContact[]>>({});
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setStatus((current) => (current === 'ready' ? current : 'loading'));
    setError(null);

    try {
      // The reports are the one read that must succeed.
      const mine = await api.myIssues();

      const [hostel, mess, hostels, messHalls] = await Promise.all([
        api.myHostel().catch(() => null),
        api.myMess().catch(() => null),
        api.listHostels().catch(() => null),
        api.listMess().catch(() => null),
      ]);

      const places = reportableFacilities({ hostel, mess, hostels, messHalls });

      const byFacility: Record<string, DutyContact[]> = {};
      for (const place of places) {
        byFacility[facilityKey(place)] =
          place.type === 'hostel'
            ? hostelContacts(hostel)
            : messContacts(mess?.mess_details?.mess_team ?? null);
      }

      setIssues(mine.issues ?? []);
      setFacilities(places);
      setContacts(byFacility);
      setStatus('ready');
    } catch (e) {
      setError(
        e instanceof ApiClientError
          ? e.message
          : e instanceof Error
            ? e.message
            : 'Could not load your reports.',
      );
      setStatus('error');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * File the draft, then re-read the list.
   *
   * Refetching rather than pushing the new report in locally: the server decides
   * the room fallback and the timestamps, so a locally assembled row would differ
   * from the one everybody else sees.
   */
  const report = useCallback(
    async (draft: ReportDraft) => {
      const request = draftToRequest(draft, facilities);
      if (!request) throw new Error('That report is not ready to send.');

      const created = await api.reportIssue(request);
      const refreshed = await api.myIssues().catch(() => null);
      if (refreshed) setIssues(refreshed.issues ?? []);
      return created.issue_id;
    },
    [facilities],
  );

  return { facilities, issues, contacts, status, error, reload: load, report };
}
