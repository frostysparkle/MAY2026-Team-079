/**
 * Pure derivations for the Fest Control Board.
 *
 * Everything the board displays that is not a raw API field is computed here, as
 * a function of data in, figures out — no hooks, no clock reads that are not
 * injectable, no fetching. That is what makes the board's arithmetic testable
 * without mounting it.
 *
 * Two conventions run through the whole file, both inherited from
 * `features/occupancy.ts`:
 *
 *  - **`null` is not zero.** Per-entity statistics are Super-Admin-only and can
 *    fail individually, so a figure that could not be read stays `null` and
 *    renders as "—". Flattening it to `0` would read as "nobody is allocated",
 *    which is a different and much worse claim.
 *  - **Partial totals are `null`.** A sum over a set where some members failed to
 *    load understates the answer while looking exactly like a real figure.
 */

import type {
  Event,
  EventParticipationResponse,
  Workshop,
  BackendTeamMember,
  Hostel,
  Mess,
} from '@/api/types';
import { share } from '@/features/occupancy';
import { readEventCapacity, type EventCapacityReadout } from '@/features/events/eventCapacity';
import { readEventExtras } from '@/features/events/eventExtras';

/* ---------------------------------------------------------------- events --- */

/**
 * Parse a schedule round's time.
 *
 * Unlike audit timestamps (see `auditSeries.parseLogTime`), these are strings an
 * admin typed into the event editor, and they mean local fest time — so the
 * platform's local-time reading of an offset-less string is the correct one
 * here. `schedule[].start_time` is a free string the backend never validates, so
 * anything unparseable yields `null` and the round is simply treated as
 * unscheduled rather than being forced into a bogus date.
 */
export function parseScheduleTime(value: string | undefined): Date | null {
  if (!value || !value.trim()) return null;
  const at = new Date(value);
  return Number.isNaN(at.getTime()) ? null : at;
}

export type EventPhase = 'live' | 'upcoming' | 'past' | 'unscheduled';

/**
 * How long a round with no end time is treated as still running.
 *
 * An organiser who leaves the end blank has not said the round is over, so it
 * has to stay live for a while. But "forever" makes the board permanently wrong:
 * a round whose start parsed to some date months ago would sit in the Live Now
 * list for the rest of the fest, and a strip that cries wolf is a strip nobody
 * reads. Twelve hours is longer than any single round and short enough that a
 * stale one falls out on its own.
 */
export const OPEN_ENDED_ROUND_HOURS = 12;

export interface EventRow {
  event: Event;
  id: string;
  name: string;
  type: string;
  /**
   * `event.registration.is_open` — derived server-side on every read
   * (`events._with_computed_registration`), never a stored or top-level field.
   */
  open: boolean;
  phase: EventPhase;
  /** Registrations, or `null` when this event's participation call failed. */
  registrations: number | null;
  /** Attendance scans recorded today, or `null` when unreadable. */
  scansToday: number | null;
  /** When the next round starts, for upcoming events. */
  startsAt: Date | null;
  /** The round running right now, if any. */
  liveRound: string | null;
  teamSize: number;
  /**
   * Today's admissions against the organiser's published capacity — the door,
   * story 3.2. Resets at local midnight, because `scansToday` does.
   *
   * `null` for the many events that publish no capacity, which is a different
   * state from "no entries left" and must not be summed as zero. See
   * `features/events/eventCapacity`.
   *
   * Named `gate` rather than `capacity` on purpose. This used to be the only
   * capacity figure the board had, under a name that read like registration
   * inventory, so a daily door count was being consumed as "how many places are
   * left on this event" — two different questions with two different answers.
   */
  gate: EventCapacityReadout | null;
  /**
   * Cumulative registrations against the same published capacity — demand.
   *
   * The figure an admin acts on *before* the event: bookings can be at the limit
   * while the door has admitted nobody, and only this side of the pair can say so.
   * `readEventCrowd` has always drawn this distinction for the participant-facing
   * screens; the board had only ever computed the door half.
   */
  demand: EventCapacityReadout | null;
}

/**
 * Classify an event against the clock.
 *
 * An event is *live* while any of its rounds is in window, *upcoming* while a
 * round is still ahead, *past* once every round has ended, and *unscheduled*
 * when no round carries a parseable time — which is a real and common state
 * during setup, and deliberately not folded into "upcoming".
 */
export function eventPhase(event: Event, now: Date = new Date()): EventPhase {
  const rounds = (event.schedule ?? [])
    .map((round) => ({
      name: round.name,
      start: parseScheduleTime(round.start_time),
      end: parseScheduleTime(round.end_time),
    }))
    .filter((round) => round.start !== null || round.end !== null);

  if (rounds.length === 0) return 'unscheduled';

  const time = now.getTime();
  for (const round of rounds) {
    if (isRoundLive(round.start, round.end, time)) return 'live';
  }
  if (rounds.some((round) => (round.start?.getTime() ?? Infinity) > time)) return 'upcoming';
  return 'past';
}

/**
 * Whether one round is running at `time`.
 *
 * The single definition of "live", shared by `eventPhase` and `liveRoundName` so
 * the count and the named list can never disagree about which rounds qualify.
 */
function isRoundLive(start: Date | null, end: Date | null, time: number): boolean {
  if (start === null && end === null) return false;
  const startMs = start?.getTime() ?? -Infinity;
  const endMs =
    end?.getTime() ??
    (start === null ? Infinity : start.getTime() + OPEN_ENDED_ROUND_HOURS * 3_600_000);
  return time >= startMs && time <= endMs;
}

/** The name of whichever round is running now. */
function liveRoundName(event: Event, now: Date): string | null {
  const time = now.getTime();
  for (const round of event.schedule ?? []) {
    const start = parseScheduleTime(round.start_time);
    const end = parseScheduleTime(round.end_time);
    if (isRoundLive(start, end, time)) return round.name;
  }
  return null;
}

/** The earliest round start still in the future. */
function nextStart(event: Event, now: Date): Date | null {
  const upcoming = (event.schedule ?? [])
    .map((round) => parseScheduleTime(round.start_time))
    .filter((at): at is Date => at !== null && at.getTime() > now.getTime())
    .sort((a, b) => a.getTime() - b.getTime());
  return upcoming[0] ?? null;
}

export function buildEventRows(
  events: Event[],
  participation: Record<string, EventParticipationResponse>,
  now: Date = new Date(),
): EventRow[] {
  return events.map((event) => {
    const stat = participation[event.event_id];
    return {
      event,
      id: event.event_id,
      name: event.name,
      type: event.event_type,
      open: Boolean(event.registration.is_open),
      phase: eventPhase(event, now),
      registrations: stat ? stat.count : null,
      // Absent for UHC callers, so narrow rather than assert — the board is
      // super-admin-only today, but the response type does not promise that.
      scansToday:
        stat && typeof stat.total_daily_scans === 'number' ? stat.total_daily_scans : null,
      startsAt: nextStart(event, now),
      liveRound: liveRoundName(event, now),
      teamSize: event.event_team?.length ?? 0,
      gate: readEventCapacity(
        readEventExtras(event.registration).capacity,
        stat && typeof stat.total_daily_scans === 'number' ? stat.total_daily_scans : null,
      ),
      demand: readEventCapacity(
        readEventExtras(event.registration).capacity,
        stat ? stat.count : null,
      ),
    };
  });
}

export interface EventSummary {
  total: number;
  open: number;
  closed: number;
  live: number;
  upcoming: number;
  past: number;
  unscheduled: number;
  /** Σ registrations, or `null` unless every event's participation was read. */
  registrations: number | null;
  /** Σ attendance scans today, or `null` unless every event was read. */
  scansToday: number | null;
  /**
   * Turnout at the events whose doors actually operated today: today's scans as a
   * share of *those* events' registrations.
   *
   * This replaces `attendanceRate`, which divided today's scans by the
   * registrations of **every** event in the fest. On a 54-event fest where three
   * run today, the numerator could only ever come from those three while the
   * denominator carried all 54, so the board reported single-digit "attendance"
   * on a well-attended day and an event that ran yesterday dragged it down
   * forever. Restricting the denominator to the same events the numerator can come
   * from is what makes it a rate rather than an artefact.
   *
   * `null` when no event has a door open today, or when any contributing event's
   * figures were unreadable — an unknown is not a zero.
   */
  turnoutToday: number | null;
  /** How many events `turnoutToday` is measured across. */
  turnoutEvents: number;
  /** Events with a readable count of zero. Unread events are excluded. */
  withoutRegistrations: EventRow[];
  /** Best-attended events, most registrations first. */
  topByRegistrations: EventRow[];
  /** Running right now. */
  liveNow: EventRow[];
  /** Starting within `withinHours`, soonest first. */
  startingSoon: EventRow[];
  /** How many events have published an entry capacity at all. */
  withCapacity: number;
  /**
   * Σ entries left *at the door today* across events that publish a capacity, or
   * `null` unless every one of them was readable. Events with no published
   * capacity contribute nothing — they are not "full", they are unlimited as far
   * as the fest knows.
   *
   * Every field below is prefixed `gate` because all of them reset at local
   * midnight with `scansToday`. The unprefixed names they replace read like
   * registration inventory and were consumed as such.
   */
  gateEntriesLeft: number | null;
  /** Today's admissions have met or passed the limit. Fullest first. */
  gateAtCapacity: EventRow[];
  /** Today's admissions are 75% or more of the way through it. Fullest first. */
  gateNearCapacity: EventRow[];
  /**
   * Registrations have met or passed the published limit. Fullest first.
   *
   * Disjoint from `gateAtCapacity` in general: an event can be fully booked with
   * nobody through the door yet, which is exactly the state worth acting on and
   * the one the board could not previously see.
   */
  demandAtCapacity: EventRow[];
}

export function summariseEvents(
  rows: EventRow[],
  withinHours = 6,
  now: Date = new Date(),
): EventSummary {
  const readable = rows.filter((row) => row.registrations !== null);
  const allRead = readable.length === rows.length && rows.length > 0;

  const scansReadable = rows.filter((row) => row.scansToday !== null);
  const allScansRead = scansReadable.length === rows.length && rows.length > 0;

  const registrations = allRead
    ? readable.reduce((sum, row) => sum + (row.registrations ?? 0), 0)
    : null;
  const scansToday = allScansRead
    ? scansReadable.reduce((sum, row) => sum + (row.scansToday ?? 0), 0)
    : null;

  // Takes the clock from the caller, like `eventPhase` and `buildEventRows` do.
  // `row.phase` was computed against whatever `now` built the rows, so reading
  // the wall clock here instead would mix two clocks: rows built for a fixed
  // instant would be filtered against the real one, and events outside the
  // horizon would leak into `startingSoon`.
  const horizon = now.getTime() + withinHours * 3_600_000;

  // Only events that actually declare a limit take part in the capacity figures.
  const capped = rows.filter((row) => row.gate !== null);
  const cappedRead = capped.filter((row) => row.gate?.remaining !== null);
  // Fullest first, so the rows an admin has to act on lead both lists.
  const byFullestGate = (a: EventRow, b: EventRow) =>
    (b.gate?.percent ?? 0) - (a.gate?.percent ?? 0);
  const byFullestDemand = (a: EventRow, b: EventRow) =>
    (b.demand?.percent ?? 0) - (a.demand?.percent ?? 0);

  /*
   * The events whose doors operated today: running right now, or already scanned
   * somebody in. An event that has not opened contributes to neither side of the
   * turnout ratio, which is the whole correction — it has not "had 0% turnout",
   * it has not happened.
   */
  const openedToday = rows.filter(
    (row) => row.phase === 'live' || (row.scansToday !== null && row.scansToday > 0),
  );
  /*
   * Requires every event to be readable, not just the ones known to have opened.
   * An event whose participation call failed has an unknown scan count, so it
   * might belong in `openedToday` — and if it does, leaving it out shifts both
   * sides of the ratio. Following the same null-over-guess rule as `registrations`
   * and `scansToday` above keeps a partial read from rendering as a real rate.
   */
  const fullyReadable =
    rows.length > 0 && rows.every((row) => row.registrations !== null && row.scansToday !== null);
  const turnoutRegistrations = openedToday.reduce((sum, row) => sum + (row.registrations ?? 0), 0);
  const turnoutScans = openedToday.reduce((sum, row) => sum + (row.scansToday ?? 0), 0);
  const turnoutComplete = fullyReadable && openedToday.length > 0;

  return {
    total: rows.length,
    open: rows.filter((row) => row.open).length,
    closed: rows.filter((row) => !row.open).length,
    live: rows.filter((row) => row.phase === 'live').length,
    upcoming: rows.filter((row) => row.phase === 'upcoming').length,
    past: rows.filter((row) => row.phase === 'past').length,
    unscheduled: rows.filter((row) => row.phase === 'unscheduled').length,
    registrations,
    scansToday,
    turnoutToday:
      turnoutComplete && turnoutRegistrations > 0
        ? (turnoutScans / turnoutRegistrations) * 100
        : null,
    turnoutEvents: openedToday.length,
    withoutRegistrations: readable.filter((row) => row.registrations === 0),
    topByRegistrations: [...readable].sort(
      (a, b) => (b.registrations ?? 0) - (a.registrations ?? 0),
    ),
    liveNow: rows.filter((row) => row.phase === 'live'),
    startingSoon: rows
      .filter(
        (row) =>
          row.phase === 'upcoming' && row.startsAt !== null && row.startsAt.getTime() <= horizon,
      )
      .sort((a, b) => (a.startsAt?.getTime() ?? 0) - (b.startsAt?.getTime() ?? 0)),
    withCapacity: capped.length,
    gateEntriesLeft:
      capped.length > 0 && cappedRead.length === capped.length
        ? cappedRead.reduce((sum, row) => sum + (row.gate?.remaining ?? 0), 0)
        : null,
    gateAtCapacity: capped.filter((row) => row.gate?.atCapacity).sort(byFullestGate),
    gateNearCapacity: capped
      .filter((row) => row.gate?.status === 'filling' || row.gate?.status === 'full')
      .sort(byFullestGate),
    demandAtCapacity: rows.filter((row) => row.demand?.atCapacity).sort(byFullestDemand),
  };
}

/* ------------------------------------------------------------- workshops --- */

export interface WorkshopRow {
  workshop: Workshop;
  id: string;
  name: string;
  slotId: string;
  capacity: number;
  registrations: number;
  attended: number;
  /** Seats sold as a share of capacity. */
  fillPercent: number | null;
  /** Attended as a share of registrations — the number nothing else surfaces. */
  showRate: number | null;
  soldOut: boolean;
  staffed: boolean;
  /** At least one assigned volunteer may scan attendance. */
  scanning: boolean;
}

export function buildWorkshopRows(workshops: Workshop[]): WorkshopRow[] {
  return workshops.map((workshop) => {
    const team = workshop.workshop_team ?? [];
    return {
      workshop,
      id: workshop.workshop_id,
      name: workshop.name,
      slotId: workshop.slot_id,
      capacity: workshop.capacity,
      registrations: workshop.registration_count,
      attended: workshop.participant_count,
      fillPercent: share(workshop.registration_count, workshop.capacity),
      showRate: share(workshop.participant_count, workshop.registration_count),
      soldOut: workshop.capacity > 0 && workshop.registration_count >= workshop.capacity,
      staffed: team.length > 0,
      scanning: team.some((member) => member.attendance),
    };
  });
}

export interface WorkshopSummary {
  total: number;
  capacity: number;
  registrations: number;
  attended: number;
  seatsLeft: number;
  fillPercent: number | null;
  showRate: number | null;
  soldOut: number;
  empty: number;
  /** Concluded workshops where fewer than half the bookings turned up. */
  poorTurnout: WorkshopRow[];
  fullest: WorkshopRow[];
}

export function summariseWorkshops(rows: WorkshopRow[]): WorkshopSummary {
  const capacity = rows.reduce((sum, row) => sum + row.capacity, 0);
  const registrations = rows.reduce((sum, row) => sum + row.registrations, 0);
  const attended = rows.reduce((sum, row) => sum + row.attended, 0);

  return {
    total: rows.length,
    capacity,
    registrations,
    attended,
    seatsLeft: Math.max(0, capacity - registrations),
    fillPercent: share(registrations, capacity),
    showRate: share(attended, registrations),
    soldOut: rows.filter((row) => row.soldOut).length,
    empty: rows.filter((row) => row.registrations === 0).length,
    // Only workshops that have actually started admitting people: a workshop
    // with no scans yet has not "under-performed", it has not happened.
    poorTurnout: rows.filter(
      (row) => row.attended > 0 && row.showRate !== null && row.showRate < 50,
    ),
    fullest: [...rows].sort((a, b) => (b.fillPercent ?? 0) - (a.fillPercent ?? 0)),
  };
}

/* ----------------------------------------------------------------- staff --- */

export interface StaffDuty {
  domain: 'events' | 'mess' | 'hostels' | 'workshops';
  entityId: string;
  entityName: string;
  role: string;
  /** Whether this assignment may currently scan. */
  scanning: boolean;
}

export interface StaffWorkloadRow {
  member: BackendTeamMember;
  id: string;
  email: string;
  role: string;
  department: string;
  duties: StaffDuty[];
  /** Assignments where scanning is switched off. */
  mutedDuties: StaffDuty[];
  activeToday: boolean;
}

/**
 * Join the staff roster against every team array on the board.
 *
 * This costs no extra requests: `event_team`, `mess_team`, `hostel_team` and
 * `workshop_team` all arrive with the entity lists the other panels already
 * needed. A staffer's workload is simply how many of those arrays name them.
 *
 * Note that `GET /workshops` strips `workshop_team` for non-super-admin callers.
 * The board is super-admin-only so it is present, but the field stays optional
 * and an absent array contributes no duties rather than throwing.
 */
export function buildStaffWorkload(
  team: BackendTeamMember[],
  entities: { events: Event[]; mess: Mess[]; hostels: Hostel[]; workshops: Workshop[] },
  activeActorIds: Set<string>,
): StaffWorkloadRow[] {
  const duties = new Map<string, StaffDuty[]>();
  const add = (userId: string | null | undefined, duty: StaffDuty) => {
    if (!userId) return;
    const list = duties.get(userId);
    if (list) list.push(duty);
    else duties.set(userId, [duty]);
  };

  for (const event of entities.events) {
    for (const member of event.event_team ?? []) {
      add(member.user_id, {
        domain: 'events',
        entityId: event.event_id,
        entityName: event.name,
        role: member.role,
        // Events have no per-member scan toggle — assignment is permission.
        scanning: true,
      });
    }
  }
  for (const hall of entities.mess) {
    for (const member of hall.mess_team ?? []) {
      add(member.user_id, {
        domain: 'mess',
        entityId: hall.mess_id,
        entityName: hall.name,
        role: member.role,
        scanning: Boolean(member.logging),
      });
    }
  }
  for (const block of entities.hostels) {
    for (const member of block.hostel_team ?? []) {
      add(member.user_id, {
        domain: 'hostels',
        entityId: block.hostel_id,
        entityName: block.name,
        role: member.role,
        // Hostels name this field `attendance`, not `logging` — see
        // `HostelTeamMember` for why the two facility teams disagree on it.
        scanning: Boolean(member.attendance),
      });
    }
  }
  for (const workshop of entities.workshops) {
    for (const member of workshop.workshop_team ?? []) {
      add(member.user_id, {
        domain: 'workshops',
        entityId: workshop.workshop_id,
        entityName: workshop.name,
        role: member.role,
        scanning: Boolean(member.attendance),
      });
    }
  }

  return team.map((member) => {
    const assigned = duties.get(member.paradox_id) ?? [];
    return {
      member,
      id: member.paradox_id,
      email: member.email,
      role: member.role,
      department: member.department,
      duties: assigned,
      mutedDuties: assigned.filter((duty) => !duty.scanning),
      activeToday: activeActorIds.has(member.paradox_id),
    };
  });
}

export interface StaffOpsSummary {
  accounts: number;
  activeToday: number;
  assigned: number;
  unassigned: number;
  /** Assignments with scanning switched off, across every staffer. */
  mutedAssignments: number;
  /** Staffers holding at least one muted assignment. */
  staffWithMuted: StaffWorkloadRow[];
  /** 0 / 1 / 2 / 3+ duties. */
  workloadBuckets: { key: string; label: string; value: number }[];
  byDepartment: { department: string; count: number }[];
  /** Most-loaded staffers first. */
  busiest: StaffWorkloadRow[];
}

export function summariseStaffOps(rows: StaffWorkloadRow[]): StaffOpsSummary {
  const assigned = rows.filter((row) => row.duties.length > 0);
  const departments = new Map<string, number>();
  for (const row of rows) {
    const key = row.department || 'Unrecorded';
    departments.set(key, (departments.get(key) ?? 0) + 1);
  }

  return {
    accounts: rows.length,
    activeToday: rows.filter((row) => row.activeToday).length,
    assigned: assigned.length,
    unassigned: rows.length - assigned.length,
    mutedAssignments: rows.reduce((sum, row) => sum + row.mutedDuties.length, 0),
    staffWithMuted: rows.filter((row) => row.mutedDuties.length > 0),
    workloadBuckets: [
      { key: '0', label: 'None', value: rows.filter((r) => r.duties.length === 0).length },
      { key: '1', label: '1', value: rows.filter((r) => r.duties.length === 1).length },
      { key: '2', label: '2', value: rows.filter((r) => r.duties.length === 2).length },
      { key: '3', label: '3+', value: rows.filter((r) => r.duties.length >= 3).length },
    ],
    byDepartment: [...departments.entries()]
      .map(([department, count]) => ({ department, count }))
      .sort((a, b) => b.count - a.count),
    busiest: [...rows]
      .filter((row) => row.duties.length > 0)
      .sort((a, b) => b.duties.length - a.duties.length),
  };
}

/* ---------------------------------------------------------- participants --- */

export interface ReachBreakdown {
  domain: 'hostels' | 'mess' | 'events' | 'workshops';
  label: string;
  count: number;
}

/**
 * How many distinct participants each domain has touched.
 *
 * Workshops contribute a *count*, not a set: `GET /workshops` returns
 * `registration_count` with no participant ids, so a workshop booking cannot be
 * matched to a person. That is why this returns per-domain figures rather than a
 * single deduplicated union — with the real total now available from
 * `/participants/statistics`, the union was only ever a proxy for it.
 */
export function reachByDomain(input: {
  hostelParticipantIds: Set<string>;
  messParticipantIds: Set<string>;
  eventParticipantIds: Set<string>;
  workshopRegistrations: number;
}): ReachBreakdown[] {
  return [
    { domain: 'hostels', label: 'Hostels', count: input.hostelParticipantIds.size },
    { domain: 'mess', label: 'Mess', count: input.messParticipantIds.size },
    { domain: 'events', label: 'Events', count: input.eventParticipantIds.size },
    { domain: 'workshops', label: 'Workshops', count: input.workshopRegistrations },
  ];
}

/** How many domains each participant appears in, as fixed buckets. */
export function engagementDepth(
  sets: Set<string>[],
): { key: string; label: string; value: number }[] {
  const counts = new Map<string, number>();
  for (const set of sets) {
    for (const id of set) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  const depths = [...counts.values()];
  return [1, 2, 3].map((depth) => ({
    key: `${depth}`,
    label: depth === 3 ? '3+' : `${depth}`,
    value: depths.filter((d) => (depth === 3 ? d >= 3 : d === depth)).length,
  }));
}
