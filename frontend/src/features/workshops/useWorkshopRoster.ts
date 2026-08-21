import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, ApiClientError } from '@/api';
import type {
  Workshop,
  WorkshopParticipationResponse,
  WorkshopTeamMemberDetail,
} from '@/api/types';
import { currentStaff } from '@/stores/authStore';
import { ledgerAdmissions, readScanLedger } from './scanLedger';
import {
  attendanceCounts,
  buildRoster,
  mergeDeviceScans,
  mergeParticipation,
  rosterLists,
  type RosterEntry,
  type RosterLists,
  type WorkshopAttendanceCounts,
} from './workshopRoster';

/**
 * One workshop as its volunteers and managers need it: the record, the attendance
 * figures, and the roster split into who came and who did not.
 *
 * Three sources, in order of authority, and none of them allowed to sink the page:
 *
 *   1. `GET /workshops/{id}/participation` — the roster, with each registrant's
 *      name and academic level, readable by this workshop's own team as well as by
 *      a Super Admin. This is the one that matters.
 *   2. `GET /workshops/{id}/logs` — Super Admin-only, and now used only for what
 *      the roster cannot say: *when* each booking and scan happened.
 *   3. This device's scan ledger — the last resort, for a caller the roster route
 *      refuses (an unassigned staff account, or a member removed mid-shift). Not
 *      merged when the roster is readable, so stale local rows can never contradict
 *      the server.
 *
 * `GET /workshops` is still fetched for the record itself: capacity and the two
 * counters, which every staff token may read whatever the roster route says.
 */

export interface WorkshopRosterState {
  workshop: Workshop | null;
  counts: WorkshopAttendanceCounts | null;
  lists: RosterLists;
  /** True when the roster route answered — the caller is on the team or an admin. */
  rosterReadable: boolean;
  /**
   * The roster route refused this account (403), which is the server saying they
   * are not on this workshop's team. Distinct from any other failure: a 403 is an
   * answer about authority, where a 500 or a dropped connection is not, and the two
   * deserve different screens.
   */
  rosterForbidden: boolean;
  /** True when the Super Admin-only log answered, which adds the timestamps. */
  logsReadable: boolean;
  /** Why the roster could not be read, for the note the desk shows. */
  rosterError: string | null;
  /** How many scans this device contributed, roster readable or not. */
  deviceScanCount: number;
  /**
   * This workshop's team. From the roster route when readable (so a volunteer can
   * finally see it), otherwise from `workshop_team` on the record, which only a
   * Super Admin receives. `undefined` means neither was readable.
   */
  team: WorkshopTeamMemberDetail[] | undefined;
  /** This staffer's own entry on the team, when the team is readable at all. */
  membership: WorkshopTeamMemberDetail | null | undefined;
  /** The workshop record could not be loaded at all. */
  error: string | null;
  loading: boolean;
  reload: () => void;
}

const NO_ENTRIES: RosterEntry[] = [];
const EMPTY_LISTS: RosterLists = {
  all: NO_ENTRIES,
  attended: NO_ENTRIES,
  absent: NO_ENTRIES,
  onSpot: NO_ENTRIES,
};

export function useWorkshopRoster(workshopId: string): WorkshopRosterState {
  const staff = currentStaff();
  const [workshop, setWorkshop] = useState<Workshop | null>(null);
  const [participation, setParticipation] = useState<WorkshopParticipationResponse | null>(null);
  const [entries, setEntries] = useState<RosterEntry[] | null>(null);
  const [rosterReadable, setRosterReadable] = useState(false);
  const [rosterForbidden, setRosterForbidden] = useState(false);
  const [logsReadable, setLogsReadable] = useState(false);
  const [rosterError, setRosterError] = useState<string | null>(null);
  const [deviceScanCount, setDeviceScanCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    if (!workshopId) return Promise.resolve();

    // Both secondary fetches resolve rather than reject on failure, so a 403 on
    // either leaves the workshop half — and every count on the screen — intact.
    const rosterPromise = api
      .workshopParticipation(workshopId)
      .then((res) => ({ res, ok: true, forbidden: false, message: null as string | null }))
      .catch((e) => ({
        res: null,
        ok: false,
        forbidden: e instanceof ApiClientError && e.status === 403,
        message:
          e instanceof ApiClientError
            ? e.message
            : 'The workshop roster could not be read from this account.',
      }));

    const logPromise = api
      .workshopLogs(workshopId)
      .then((res) => ({ logs: res.logs, ok: true }))
      .catch(() => ({ logs: [], ok: false }));

    return Promise.all([api.listWorkshops(), rosterPromise, logPromise])
      .then(([all, roster, log]) => {
        const found = all.find((w) => w.workshop_id === workshopId) ?? null;
        setWorkshop(found);
        setError(found ? null : 'That workshop no longer exists.');

        setDeviceScanCount(readScanLedger(workshopId).length);
        setParticipation(roster.res);
        setRosterReadable(roster.ok);
        setRosterForbidden(roster.forbidden);
        setRosterError(roster.ok ? null : roster.message);
        setLogsReadable(log.ok);

        // Timestamps first, then the server's roster over the top, and the local
        // ledger only when the server would tell us nothing at all.
        const fromLogs = buildRoster(log.logs);
        if (roster.res) {
          setEntries(mergeParticipation(fromLogs, roster.res.participants));
        } else {
          setEntries(mergeDeviceScans(fromLogs, ledgerAdmissions(workshopId)));
        }
      })
      .catch((e) =>
        setError(e instanceof ApiClientError ? e.message : 'Could not load the workshop.'),
      )
      .finally(() => setLoading(false));
  }, [workshopId]);

  useEffect(() => {
    void load();
  }, [load]);

  const lists = useMemo(() => (entries ? rosterLists(entries) : EMPTY_LISTS), [entries]);

  const counts = useMemo(() => {
    if (!workshop) return null;
    // The roster route counts on-spot admissions server-side; the log can count
    // them too. Unknown stays null rather than becoming a misleading zero.
    const onSpot = participation
      ? participation.on_spot_count
      : logsReadable
        ? lists.onSpot.length
        : null;
    return attendanceCounts(workshop, onSpot);
  }, [workshop, participation, logsReadable, lists.onSpot.length]);

  // `workshop_team` is projected out of `GET /workshops` for everyone but a Super
  // Admin, which is why the roster route returns the team as well: for a volunteer
  // that response is the only place their own designation is visible.
  const team = useMemo<WorkshopTeamMemberDetail[] | undefined>(() => {
    if (participation) return participation.workshop_team;
    if (workshop?.workshop_team) {
      return workshop.workshop_team.map((member) => ({
        user_id: member.user_id,
        role: member.role,
        attendance: member.attendance,
        name: null,
        phone: null,
      }));
    }
    return undefined;
  }, [participation, workshop]);

  const membership = useMemo(() => {
    if (team === undefined) return undefined;
    return team.find((member) => member.user_id === staff?.id) ?? null;
  }, [team, staff?.id]);

  return {
    workshop,
    counts,
    lists,
    rosterReadable,
    rosterForbidden,
    logsReadable,
    rosterError,
    deviceScanCount,
    team,
    membership,
    error,
    loading,
    reload: () => void load(),
  };
}
