import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '@/api';
import { hoursAgoIso, localDayBounds } from './auditSeries';
import type {
  AuditLogEntry,
  AuditLogSummary,
  BackendTeamMember,
  Event,
  EventParticipationResponse,
  Hostel,
  HostelStatisticsResponse,
  Mess,
  MessStatisticsResponse,
  ParticipantStatisticsResponse,
  QueryRecord,
  StaffIssue,
  Workshop,
} from '@/api/types';

/**
 * Loads everything the Fest Control Board shows, in three waves.
 *
 * ── Why tiers ───────────────────────────────────────────────────────────────
 * There is no aggregate statistics endpoint, so a full board is roughly eighty
 * requests: one per hostel block, one per mess hall, and — by far the dominant
 * cost — one participation call per event. Blocking the whole page on the
 * slowest of those would leave an admin staring at skeletons for seconds while
 * data that arrived immediately sat unrendered.
 *
 * So the board paints in waves, and each wave refreshes at a cadence that suits
 * what it measures:
 *
 *  - **fast** (~10 requests) — participant totals, workshops, staff, the audit
 *    trail. Every figure comes from a list endpoint, so this lands quickly and
 *    the alert strip can already run most of its rules. Meal swipes move minute
 *    to minute, so this tier polls hardest.
 *  - **medium** (~30 requests) — mess and hostel occupancy, one statistics call
 *    per entity.
 *  - **slow** (~40 requests) — event participation. Registration counts do not
 *    need thirty-second freshness.
 *
 * No wave blocks another and a failure inside one never blanks the others: each
 * per-entity call swallows its own error, exactly as `useHostelInventory` does,
 * so one bad block cannot take down the campus figure. What it *does* do is name
 * itself in `failedDomains`, which the alert strip turns into a visible notice —
 * a partial total that looks complete is the one failure mode a monitoring board
 * must never have.
 *
 * ── Read-only ───────────────────────────────────────────────────────────────
 * Every call here is a GET. The board has no mutation path by construction.
 */

/** Poll cadence per tier, in milliseconds. */
export const TIER_CADENCE = {
  fast: 30_000,
  medium: 60_000,
  slow: 120_000,
} as const;

export type TierName = keyof typeof TIER_CADENCE;

/**
 * How much of the audit trail to pull per action. `limit` is applied server-side
 * before any filter, so each action gets its own call — and `MESS_SCAN` gets the
 * largest window because it is the highest-volume action by a wide margin.
 */
export const AUDIT_LIMITS = {
  messScans: 2000,
  hostelEntry: 1000,
  hostelExit: 1000,
  accommodation: 1000,
  eventRegistrations: 1000,
  recent: 60,
  /**
   * The hourly-trend window. Generous because it is bounded by *time* rather
   * than by count — `PULSE_HOURS` of rows, whatever that turns out to be — so the
   * limit is a safety valve rather than the thing deciding the answer.
   */
  pulse: 4000,
} as const;

/**
 * How many hours of trail the hourly trend and spike detector read.
 *
 * One more than the seven `activityPulse` buckets, so the oldest bucket is
 * complete rather than clipped part-way through its hour.
 *
 * This exists because the pulse used to run on `recent` — the newest 60 rows
 * regardless of age. During a busy hour all 60 landed in that hour, leaving the
 * six baseline hours reading zero, which made a genuine surge undetectable. A
 * time-bounded window is the only shape of request that can answer "how does this
 * hour compare with the last six".
 */
export const PULSE_HOURS = 8;

export interface TierState {
  loading: boolean;
  /** When this tier last completed, successfully or not. */
  updatedAt: Date | null;
  error: string | null;
}

export interface AuditFeeds {
  messScans: AuditLogEntry[];
  hostelEntry: AuditLogEntry[];
  hostelExit: AuditLogEntry[];
  /** `ACCOMMODATION_REGISTER` and `ACCOMMODATION_CANCEL` interleaved. */
  accommodation: AuditLogEntry[];
  /** `EVENT_REGISTER` and `EVENT_DEREGISTER` interleaved. */
  eventRegistrations: AuditLogEntry[];
  /** Unfiltered and recent, newest first — the activity ticker. */
  recent: AuditLogEntry[];
  /**
   * Unfiltered, bounded by time rather than count — the last `PULSE_HOURS`
   * hours. What the hourly trend and the spike detector read, because a
   * count-bounded feed cannot describe how one hour compares with the previous
   * six.
   */
  pulse: AuditLogEntry[];
  /**
   * Exact counts for the viewer's current calendar day, straight from
   * `GET /audit-logs/summary`. `null` while loading or if the call failed.
   *
   * This is what any figure labelled "today" should read. Deriving a daily number
   * by filtering a capped feed makes it a floor the moment the fest produces more
   * rows in a day than the cap allows.
   */
  today: AuditLogSummary | null;
  /** Exact counts for the whole trail, unbounded by any window. */
  trail: AuditLogSummary | null;
  /** Feeds that came back exactly at their limit, and so may be truncated. */
  truncated: string[];
}

const EMPTY_FEEDS: AuditFeeds = {
  messScans: [],
  hostelEntry: [],
  hostelExit: [],
  accommodation: [],
  eventRegistrations: [],
  recent: [],
  pulse: [],
  today: null,
  trail: null,
  truncated: [],
};

/**
 * Run `task` over `items` with at most `limit` in flight.
 *
 * Firing forty participation requests simultaneously is what makes a browser
 * queue them anyway, but with every one of them counted against the connection
 * pool at once; a small window keeps the tab responsive and the earliest results
 * arriving sooner.
 */
async function mapLimit<T, R>(
  items: T[],
  limit: number,
  task: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;

  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      results[index] = await task(items[index]);
    }
  });

  await Promise.all(workers);
  return results;
}

/** Fetch one entity's statistics, swallowing its own failure. */
async function settle<T>(id: string, fetcher: () => Promise<T>): Promise<[string, T] | null> {
  try {
    return [id, await fetcher()];
  } catch {
    return null;
  }
}

function collect<T>(entries: ([string, T] | null)[]): Record<string, T> {
  return Object.fromEntries(entries.filter((entry): entry is [string, T] => entry !== null));
}

export interface FestSnapshot {
  participants: ParticipantStatisticsResponse | null;
  workshops: Workshop[] | null;
  staff: BackendTeamMember[] | null;
  audit: AuditFeeds;
  /**
   * Every participant query, and every reported fault, fest-wide — Story 9.1's
   * two missing panels. Both are single list calls that scope themselves to the
   * caller, and a Super Admin's scope is the fest, so this costs two requests
   * rather than one per entity. That is why they belong to the fast tier.
   */
  queries: QueryRecord[] | null;
  issues: StaffIssue[] | null;

  mess: Mess[] | null;
  messStats: Record<string, MessStatisticsResponse>;
  hostels: Hostel[] | null;
  hostelStats: Record<string, HostelStatisticsResponse>;

  events: Event[] | null;
  participation: Record<string, EventParticipationResponse>;

  tiers: Record<TierName, TierState>;
  /** Human-readable names of whatever could not be loaded. */
  failedDomains: string[];
  /** True while any tier is in flight. */
  loading: boolean;
  refresh: () => void;
}

const IDLE_TIER: TierState = { loading: true, updatedAt: null, error: null };

export function useFestSnapshot(): FestSnapshot {
  const [participants, setParticipants] = useState<ParticipantStatisticsResponse | null>(null);
  const [workshops, setWorkshops] = useState<Workshop[] | null>(null);
  const [staff, setStaff] = useState<BackendTeamMember[] | null>(null);
  const [audit, setAudit] = useState<AuditFeeds>(EMPTY_FEEDS);
  const [queries, setQueries] = useState<QueryRecord[] | null>(null);
  const [issues, setIssues] = useState<StaffIssue[] | null>(null);

  const [mess, setMess] = useState<Mess[] | null>(null);
  const [messStats, setMessStats] = useState<Record<string, MessStatisticsResponse>>({});
  const [hostels, setHostels] = useState<Hostel[] | null>(null);
  const [hostelStats, setHostelStats] = useState<Record<string, HostelStatisticsResponse>>({});

  const [events, setEvents] = useState<Event[] | null>(null);
  const [participation, setParticipation] = useState<Record<string, EventParticipationResponse>>(
    {},
  );

  const [tiers, setTiers] = useState<Record<TierName, TierState>>({
    fast: IDLE_TIER,
    medium: IDLE_TIER,
    slow: IDLE_TIER,
  });
  const [failures, setFailures] = useState<Record<string, string>>({});

  // Survives re-renders so an in-flight wave can be discarded when the component
  // unmounts mid-fetch rather than setting state on a dead tree.
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const markTier = useCallback((tier: TierName, patch: Partial<TierState>) => {
    if (!alive.current) return;
    setTiers((prev) => ({ ...prev, [tier]: { ...prev[tier], ...patch } }));
  }, []);

  const noteFailure = useCallback((key: string, label: string | null) => {
    if (!alive.current) return;
    setFailures((prev) => {
      if (label === null) {
        if (!(key in prev)) return prev;
        const rest = { ...prev };
        delete rest[key];
        return rest;
      }
      return prev[key] === label ? prev : { ...prev, [key]: label };
    });
  }, []);

  /* ── fast tier ── */

  const loadFast = useCallback(async () => {
    markTier('fast', { loading: true });

    const auditFor = async (
      key: keyof typeof AUDIT_LIMITS,
      action?: string,
      window?: { since?: string; until?: string },
    ): Promise<AuditLogEntry[]> => {
      try {
        const limit = AUDIT_LIMITS[key];
        return await api.auditLogs(limit, { ...(action ? { action } : {}), ...window });
      } catch {
        return [];
      }
    };

    // Resolved once per wave so every window in it describes the same instant.
    const day = localDayBounds();

    const [
      participantStats,
      workshopList,
      staffList,
      queryList,
      issueList,
      messScans,
      hostelEntry,
      hostelExit,
      accommodationIn,
      accommodationOut,
      eventIn,
      eventOut,
      recent,
      pulse,
      todaySummary,
      trailSummary,
    ] = await Promise.all([
      api.participantStatistics().catch(() => null),
      api.listWorkshops().catch(() => null),
      api.listBackendTeams().catch(() => null),
      // The list endpoints cap themselves, so these ask for a fest-sized window
      // rather than the 100 either would default to — a board reading "12 open"
      // off a truncated page would be quietly wrong in the one direction that
      // matters.
      api.listQueries({}, 1000).catch(() => null),
      api
        .listIssues({}, 1000)
        .then((response) => response.issues)
        .catch(() => null),
      auditFor('messScans', 'MESS_SCAN'),
      auditFor('hostelEntry', 'HOSTEL_ENTRY'),
      auditFor('hostelExit', 'HOSTEL_EXIT'),
      auditFor('accommodation', 'ACCOMMODATION_REGISTER'),
      auditFor('accommodation', 'ACCOMMODATION_CANCEL'),
      auditFor('eventRegistrations', 'EVENT_REGISTER'),
      auditFor('eventRegistrations', 'EVENT_DEREGISTER'),
      auditFor('recent'),
      auditFor('pulse', undefined, { since: hoursAgoIso(PULSE_HOURS) }),
      // Exact, server-counted, and unaffected by every limit above. Two requests
      // buy every "today" figure and every trail total on the board.
      api.auditLogSummary({ since: day.since, until: day.until }).catch(() => null),
      api.auditLogSummary({}).catch(() => null),
    ]);

    if (!alive.current) return;

    setParticipants(participantStats);
    noteFailure('participants', participantStats === null ? 'participant totals' : null);
    setWorkshops(workshopList);
    noteFailure('workshops', workshopList === null ? 'workshops' : null);
    setStaff(staffList);
    noteFailure('staff', staffList === null ? 'staff roster' : null);
    setQueries(queryList);
    noteFailure('queries', queryList === null ? 'participant queries' : null);
    setIssues(issueList);
    noteFailure('issues', issueList === null ? 'reported faults' : null);

    // A feed that came back exactly at its limit was almost certainly cut off.
    // Saying so is what stops "meals today" being read as a complete count when
    // it is really "the last 2,000 swipes".
    const truncated: string[] = [];
    if (messScans.length >= AUDIT_LIMITS.messScans) truncated.push('meal scans');
    if (hostelEntry.length >= AUDIT_LIMITS.hostelEntry) truncated.push('hostel check-ins');
    if (hostelExit.length >= AUDIT_LIMITS.hostelExit) truncated.push('hostel check-outs');
    if (eventIn.length >= AUDIT_LIMITS.eventRegistrations) truncated.push('event registrations');

    setAudit({
      messScans,
      hostelEntry,
      hostelExit,
      accommodation: [...accommodationIn, ...accommodationOut],
      eventRegistrations: [...eventIn, ...eventOut],
      recent,
      pulse,
      today: todaySummary,
      trail: trailSummary,
      truncated,
    });

    markTier('fast', { loading: false, updatedAt: new Date(), error: null });
  }, [markTier, noteFailure]);

  /* ── medium tier ── */

  const loadMedium = useCallback(async () => {
    markTier('medium', { loading: true });

    const [hallList, blockList] = await Promise.all([
      api.listMess().catch(() => null),
      api.listHostels().catch(() => null),
    ]);

    if (!alive.current) return;
    setMess(hallList);
    noteFailure('mess', hallList === null ? 'mess halls' : null);
    setHostels(blockList);
    noteFailure('hostels', blockList === null ? 'hostel blocks' : null);

    const [hallStats, blockStats] = await Promise.all([
      hallList
        ? mapLimit(hallList, 6, (hall) =>
            settle(hall.mess_id, () => api.messStatistics(hall.mess_id)),
          )
        : Promise.resolve([]),
      blockList
        ? mapLimit(blockList, 6, (block) =>
            settle(block.hostel_id, () => api.hostelStatistics(block.hostel_id)),
          )
        : Promise.resolve([]),
    ]);

    if (!alive.current) return;

    const hallStatMap = collect(hallStats);
    const blockStatMap = collect(blockStats);
    setMessStats(hallStatMap);
    setHostelStats(blockStatMap);

    const hallGap = (hallList?.length ?? 0) - Object.keys(hallStatMap).length;
    const blockGap = (blockList?.length ?? 0) - Object.keys(blockStatMap).length;
    noteFailure('messStats', hallGap > 0 ? `occupancy for ${hallGap} mess hall(s)` : null);
    noteFailure('hostelStats', blockGap > 0 ? `occupancy for ${blockGap} hostel block(s)` : null);

    markTier('medium', { loading: false, updatedAt: new Date(), error: null });
  }, [markTier, noteFailure]);

  /* ── slow tier ── */

  const loadSlow = useCallback(async () => {
    markTier('slow', { loading: true });

    const eventList = await api.listEvents().catch(() => null);
    if (!alive.current) return;
    setEvents(eventList);
    noteFailure('events', eventList === null ? 'events' : null);

    const settled = eventList
      ? await mapLimit(eventList, 6, (event) =>
          settle(event.event_id, () => api.eventParticipation(event.event_id)),
        )
      : [];

    if (!alive.current) return;

    const map = collect(settled);
    setParticipation(map);
    const gap = (eventList?.length ?? 0) - Object.keys(map).length;
    noteFailure('participation', gap > 0 ? `participation for ${gap} event(s)` : null);

    markTier('slow', { loading: false, updatedAt: new Date(), error: null });
  }, [markTier, noteFailure]);

  const refresh = useCallback(() => {
    void loadFast();
    void loadMedium();
    void loadSlow();
  }, [loadFast, loadMedium, loadSlow]);

  // One effect per tier, each on its own interval. Polling stops while the tab
  // is hidden — a board left open overnight would otherwise keep making eighty
  // requests a minute against a fest that nobody is watching — and every tier
  // refetches immediately on return, so the first thing a returning admin sees
  // is current rather than hours old.
  useEffect(() => {
    const loaders: Record<TierName, () => Promise<void>> = {
      fast: loadFast,
      medium: loadMedium,
      slow: loadSlow,
    };
    const timers: number[] = [];

    const start = () => {
      (Object.keys(loaders) as TierName[]).forEach((tier) => {
        void loaders[tier]();
        timers.push(
          window.setInterval(() => {
            void loaders[tier]();
          }, TIER_CADENCE[tier]),
        );
      });
    };

    const stop = () => {
      while (timers.length > 0) window.clearInterval(timers.pop());
    };

    const onVisibility = () => {
      stop();
      if (!document.hidden) start();
    };

    start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [loadFast, loadMedium, loadSlow]);

  const failedDomains = useMemo(() => Object.values(failures).sort(), [failures]);

  return {
    participants,
    workshops,
    staff,
    audit,
    queries,
    issues,
    mess,
    messStats,
    hostels,
    hostelStats,
    events,
    participation,
    tiers,
    failedDomains,
    loading: tiers.fast.loading || tiers.medium.loading || tiers.slow.loading,
    refresh,
  };
}
