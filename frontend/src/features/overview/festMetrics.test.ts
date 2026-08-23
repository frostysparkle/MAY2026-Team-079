import { describe, it, expect } from 'vitest';
import type {
  BackendTeamMember,
  Event,
  EventParticipationResponse,
  Hostel,
  Mess,
  ScheduleRound,
  Workshop,
} from '@/api/types';
import { writeEventRegistration } from '@/features/events/eventExtras';
import {
  buildEventRows,
  buildStaffWorkload,
  buildWorkshopRows,
  engagementDepth,
  eventPhase,
  parseScheduleTime,
  reachByDomain,
  summariseEvents,
  summariseStaffOps,
  summariseWorkshops,
} from './festMetrics';

const NOW = new Date(2026, 7, 18, 12, 0, 0);
/** A local ISO-ish string of the kind the event editor stores. */
const at = (hoursFromNow: number) => {
  const d = new Date(NOW.getTime() + hoursFromNow * 3_600_000);
  const pad = (n: number) => `${n}`.padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

function event(id: string, schedule: ScheduleRound[] = [], overrides: Partial<Event> = {}): Event {
  return {
    event_id: id,
    event_type: 'technicals',
    name: id,
    description: '',
    team: { min: 1, max: 1, house_vs_house_event: false, allow_single_registration: true },
    prize_money: [],
    registration: {},
    schedule,
    registration_fields: [],
    event_team: [],
    ...overrides,
  };
}

/**
 * An event whose organiser has published an entry capacity. Built through
 * `writeEventRegistration` rather than by hand, so the fixture cannot drift from
 * the key the admin form actually writes.
 */
function capped(id: string, capacity: number): Event {
  return event(id, [], { registration: writeEventRegistration({ capacity }) });
}

const round = (start: string, end?: string): ScheduleRound => ({
  name: 'Round 1',
  start_time: start,
  end_time: end ?? '',
});

function participation(count: number, scans?: number): EventParticipationResponse {
  return {
    count,
    participants: Array.from({ length: count }, (_, i) => ({
      participant_id: `P${i}`,
      name: null,
      email: `p${i}@x.com`,
      phone: null,
      house: null,
      team_id: null,
      team_role: null,
      photo: null,
    })),
    event_team: [],
    ...(scans === undefined ? {} : { total_daily_scans: scans }),
  };
}

function workshop(id: string, capacity: number, registered: number, attended: number): Workshop {
  return {
    workshop_id: id,
    slot_id: 'S1',
    name: id,
    venue: 'Lab',
    capacity,
    instructions: '',
    registration_count: registered,
    participant_count: attended,
  };
}

/* ---------------------------------------------------------------- events --- */

describe('parseScheduleTime', () => {
  it('returns null for an unparseable free-text time', () => {
    // `schedule[].start_time` is a string the backend never validates, and the
    // seed contains values like "1 Jun". Forcing those into a date would invent
    // a schedule that does not exist.
    expect(parseScheduleTime('not a date')).toBeNull();
    expect(parseScheduleTime(undefined)).toBeNull();
    expect(parseScheduleTime('   ')).toBeNull();
  });
});

describe('eventPhase', () => {
  it('is live while a round is in window', () => {
    expect(eventPhase(event('E1', [round(at(-1), at(1))]), NOW)).toBe('live');
  });

  it('is upcoming before the first round', () => {
    expect(eventPhase(event('E1', [round(at(2), at(4))]), NOW)).toBe('upcoming');
  });

  it('is past once every round has ended', () => {
    expect(eventPhase(event('E1', [round(at(-4), at(-2))]), NOW)).toBe('past');
  });

  it('treats a recently started round with no end time as still running', () => {
    // An organiser who left the end blank has not said the round is over.
    expect(eventPhase(event('E1', [round(at(-1))]), NOW)).toBe('live');
  });

  it('stops calling an open-ended round live once it is stale', () => {
    // Otherwise a round whose start parsed to some date months ago sits in the
    // Live Now list for the rest of the fest. `new Date('1 Jun')` really does
    // parse, so this is not hypothetical — it is what the seed data does.
    expect(eventPhase(event('E1', [round(at(-13))]), NOW)).toBe('past');
  });

  it('is unscheduled when no round carries a parseable time', () => {
    // A real and common state during setup, deliberately not folded into
    // "upcoming" — an event nobody has scheduled needs different attention.
    expect(eventPhase(event('E1', []), NOW)).toBe('unscheduled');
    expect(eventPhase(event('E1', [round('TBD', 'TBD')]), NOW)).toBe('unscheduled');
  });

  it('is live when any one of several rounds is in window', () => {
    const multi = event('E1', [round(at(-6), at(-5)), round(at(-1), at(1)), round(at(5), at(6))]);
    expect(eventPhase(multi, NOW)).toBe('live');
  });
});

describe('buildEventRows', () => {
  it('leaves registrations null when an event could not be read', () => {
    const rows = buildEventRows([event('E1'), event('E2')], { E1: participation(5, 2) }, NOW);
    expect(rows[0].registrations).toBe(5);
    expect(rows[1].registrations).toBeNull();
  });

  it('narrows total_daily_scans rather than asserting it', () => {
    // Absent for UHC callers. The board is super-admin-only today, but the
    // response type does not promise that.
    const rows = buildEventRows([event('E1')], { E1: participation(5) }, NOW);
    expect(rows[0].scansToday).toBeNull();
  });

  it('derives entries left at the door from the published capacity and the scans today', () => {
    const rows = buildEventRows([capped('E1', 200)], { E1: participation(150, 142) }, NOW);
    expect(rows[0].gate?.capacity).toBe(200);
    expect(rows[0].gate?.remaining).toBe(58);
    expect(rows[0].gate?.atCapacity).toBe(false);
  });

  /**
   * The two readouts answer different questions off the same published limit, and
   * the board previously only had the door one under a name that read like the
   * other. 150 registrations against a limit of 200 is 50 places left to book; 142
   * scanned in is 58 admissions left today. Neither figure substitutes for the
   * other.
   */
  it('reads demand from registrations, separately from the door', () => {
    const rows = buildEventRows([capped('E1', 200)], { E1: participation(150, 142) }, NOW);
    expect(rows[0].demand?.admitted).toBe(150);
    expect(rows[0].demand?.remaining).toBe(50);
    expect(rows[0].gate?.admitted).toBe(142);
    expect(rows[0].gate?.remaining).toBe(58);
  });

  it('can report a fully booked event whose door has admitted nobody', () => {
    // The state the board could not previously see: bookings closed, gate empty.
    const rows = buildEventRows([capped('E1', 200)], { E1: participation(200, 0) }, NOW);
    expect(rows[0].demand?.atCapacity).toBe(true);
    expect(rows[0].gate?.atCapacity).toBe(false);
    expect(summariseEvents(rows).demandAtCapacity.map((row) => row.id)).toEqual(['E1']);
    expect(summariseEvents(rows).gateAtCapacity).toEqual([]);
  });

  it('leaves both readouts null for an event that publishes no limit', () => {
    // Most events do not. "No limit declared" is not "no entries left".
    const rows = buildEventRows([event('E1')], { E1: participation(150, 142) }, NOW);
    expect(rows[0].gate).toBeNull();
    expect(rows[0].demand).toBeNull();
  });

  it('keeps entries left null when the scan count could not be read', () => {
    const rows = buildEventRows([capped('E1', 200)], { E1: participation(150) }, NOW);
    expect(rows[0].gate?.capacity).toBe(200);
    expect(rows[0].gate?.remaining).toBeNull();
    // Registrations were readable, so demand still resolves.
    expect(rows[0].demand?.remaining).toBe(50);
  });
});

describe('summariseEvents', () => {
  it('sums registrations only when every event was read', () => {
    const complete = summariseEvents(
      buildEventRows(
        [event('E1'), event('E2')],
        { E1: participation(3, 1), E2: participation(4, 2) },
        NOW,
      ),
    );
    expect(complete.registrations).toBe(7);
    expect(complete.scansToday).toBe(3);

    // A partial sum understates the fest while looking exactly like a real figure.
    const partial = summariseEvents(
      buildEventRows([event('E1'), event('E2')], { E1: participation(3, 1) }, NOW),
    );
    expect(partial.registrations).toBeNull();
    expect(partial.scansToday).toBeNull();
    expect(partial.turnoutToday).toBeNull();
  });

  it('lists only readable events as having no registrations', () => {
    // An unread event has not "got zero sign-ups" — nobody knows what it has.
    const rows = buildEventRows([event('E1'), event('E2')], { E1: participation(0, 0) }, NOW);
    expect(summariseEvents(rows).withoutRegistrations.map((row) => row.id)).toEqual(['E1']);
  });

  it('counts events starting inside the horizon', () => {
    const rows = buildEventRows(
      [event('Soon', [round(at(2))]), event('Later', [round(at(30))])],
      {},
      NOW,
    );
    expect(summariseEvents(rows, 6, NOW).startingSoon.map((row) => row.id)).toEqual(['Soon']);
  });

  it('reports zero totals rather than null for an empty fest', () => {
    const summary = summariseEvents([]);
    expect(summary.total).toBe(0);
    expect(summary.registrations).toBeNull();
    expect(summary.withCapacity).toBe(0);
    expect(summary.gateEntriesLeft).toBeNull();
  });

  it('sums entries left across capped events, ignoring uncapped ones', () => {
    const summary = summariseEvents(
      buildEventRows(
        [capped('E1', 200), capped('E2', 100), event('E3')],
        { E1: participation(0, 150), E2: participation(0, 10), E3: participation(0, 999) },
        NOW,
      ),
    );
    // 50 left of E1, 90 of E2. E3 declares no limit, so it contributes nothing
    // rather than being treated as unlimited-and-therefore-zero.
    expect(summary.withCapacity).toBe(2);
    expect(summary.gateEntriesLeft).toBe(140);
  });

  it('leaves the entries-left total null when one capped event is unreadable', () => {
    const summary = summariseEvents(
      buildEventRows(
        [capped('E1', 200), capped('E2', 100)],
        { E1: participation(0, 150), E2: participation(0) },
        NOW,
      ),
    );
    expect(summary.gateEntriesLeft).toBeNull();
  });

  it('ranks the events at and near their limit, fullest first', () => {
    const summary = summariseEvents(
      buildEventRows(
        [capped('Full', 100), capped('Filling', 100), capped('Quiet', 100)],
        {
          Full: participation(0, 100),
          Filling: participation(0, 80),
          Quiet: participation(0, 10),
        },
        NOW,
      ),
    );
    expect(summary.gateAtCapacity.map((row) => row.id)).toEqual(['Full']);
    expect(summary.gateNearCapacity.map((row) => row.id)).toEqual(['Full', 'Filling']);
  });
});

/* ------------------------------------------------------------- workshops --- */

describe('buildWorkshopRows / summariseWorkshops', () => {
  it('derives fill and show rate', () => {
    const [row] = buildWorkshopRows([workshop('W1', 40, 30, 15)]);
    expect(row.fillPercent).toBe(75);
    expect(row.showRate).toBe(50);
    expect(row.soldOut).toBe(false);
  });

  it('marks a workshop sold out at capacity, not only above it', () => {
    expect(buildWorkshopRows([workshop('W1', 30, 30, 0)])[0].soldOut).toBe(true);
  });

  it('leaves show rate null when nothing was booked', () => {
    expect(buildWorkshopRows([workshop('W1', 30, 0, 0)])[0].showRate).toBeNull();
  });

  it('flags poor turnout only once a workshop has admitted somebody', () => {
    // A workshop with no scans yet has not under-performed; it has not happened.
    const notStarted = summariseWorkshops(buildWorkshopRows([workshop('W1', 30, 20, 0)]));
    expect(notStarted.poorTurnout).toHaveLength(0);

    const underAttended = summariseWorkshops(buildWorkshopRows([workshop('W1', 30, 20, 4)]));
    expect(underAttended.poorTurnout.map((row) => row.id)).toEqual(['W1']);
  });

  it('aggregates seats across every workshop', () => {
    const summary = summariseWorkshops(
      buildWorkshopRows([workshop('W1', 30, 30, 20), workshop('W2', 20, 5, 5)]),
    );
    expect(summary.capacity).toBe(50);
    expect(summary.registrations).toBe(35);
    expect(summary.seatsLeft).toBe(15);
    expect(summary.soldOut).toBe(1);
    expect(summary.showRate).toBeCloseTo((25 / 35) * 100, 6);
  });
});

/* ----------------------------------------------------------------- staff --- */

function staffMember(id: string, department = 'technicals'): BackendTeamMember {
  return {
    paradox_id: id,
    email: `${id}@paradox.dev`,
    role: 'volunteer',
    department,
    designation: 'Volunteer',
  };
}

const hall = (id: string, team: Mess['mess_team']): Mess => ({
  mess_id: id,
  name: id,
  capacity: 100,
  type: 'north_indian__veg',
  mess_team: team,
});

const block = (id: string, team: Hostel['hostel_team']): Hostel => ({
  hostel_id: id,
  name: id,
  capacity: 100,
  gender: 'male',
  hostel_team: team,
});

describe('buildStaffWorkload', () => {
  const entities = {
    events: [event('E1', [], { event_team: [{ user_id: 'S1', role: 'event_head' }] })],
    mess: [hall('M1', [{ user_id: 'S1', role: 'volunteer', logging: true }])],
    hostels: [block('H1', [{ user_id: 'S2', role: 'hostel_volunteer', attendance: false }])],
    workshops: [],
  };

  it('counts every team array a staffer appears in', () => {
    const rows = buildStaffWorkload(
      [staffMember('S1'), staffMember('S2'), staffMember('S3')],
      entities,
      new Set(),
    );
    expect(rows.find((r) => r.id === 'S1')?.duties).toHaveLength(2);
    expect(rows.find((r) => r.id === 'S2')?.duties).toHaveLength(1);
    expect(rows.find((r) => r.id === 'S3')?.duties).toHaveLength(0);
  });

  it('separates assignments that cannot scan', () => {
    // A volunteer whose `logging` flag is off gets a 403 at the turnstile, and
    // nothing else in the app surfaces that.
    const rows = buildStaffWorkload([staffMember('S1'), staffMember('S2')], entities, new Set());
    expect(rows.find((r) => r.id === 'S1')?.mutedDuties).toHaveLength(0);
    expect(rows.find((r) => r.id === 'S2')?.mutedDuties).toHaveLength(1);
  });

  it('marks who has acted today', () => {
    const rows = buildStaffWorkload(
      [staffMember('S1'), staffMember('S2')],
      entities,
      new Set(['S1']),
    );
    expect(rows.find((r) => r.id === 'S1')?.activeToday).toBe(true);
    expect(rows.find((r) => r.id === 'S2')?.activeToday).toBe(false);
  });

  it('tolerates a stripped workshop_team without throwing', () => {
    // `GET /workshops` omits the field for non-super-admin callers.
    const rows = buildStaffWorkload(
      [staffMember('S1')],
      { events: [], mess: [], hostels: [], workshops: [workshop('W1', 10, 0, 0)] },
      new Set(),
    );
    expect(rows[0].duties).toHaveLength(0);
  });
});

describe('summariseStaffOps', () => {
  it('buckets workload and counts the unassigned', () => {
    const entities = {
      events: [
        event('E1', [], {
          event_team: [
            { user_id: 'S1', role: 'event_head' },
            { user_id: 'S2', role: 'volunteer' },
          ],
        }),
      ],
      mess: [hall('M1', [{ user_id: 'S1', role: 'volunteer', logging: true }])],
      hostels: [block('H1', [{ user_id: 'S1', role: 'hostel_volunteer', attendance: true }])],
      workshops: [],
    };
    const summary = summariseStaffOps(
      buildStaffWorkload(
        [staffMember('S1'), staffMember('S2'), staffMember('S3')],
        entities,
        new Set(),
      ),
    );

    expect(summary.accounts).toBe(3);
    expect(summary.assigned).toBe(2);
    expect(summary.unassigned).toBe(1);
    expect(summary.workloadBuckets.map((b) => b.value)).toEqual([1, 1, 0, 1]);
    expect(summary.busiest[0].id).toBe('S1');
  });

  it('files a blank department under a named bucket rather than dropping it', () => {
    const summary = summariseStaffOps(
      buildStaffWorkload(
        [staffMember('S1', '')],
        { events: [], mess: [], hostels: [], workshops: [] },
        new Set(),
      ),
    );
    expect(summary.byDepartment).toEqual([{ department: 'Unrecorded', count: 1 }]);
  });
});

/* ---------------------------------------------------------- participants --- */

describe('reachByDomain', () => {
  it('reports each domain separately rather than one union', () => {
    const reach = reachByDomain({
      hostelParticipantIds: new Set(['P1', 'P2']),
      messParticipantIds: new Set(['P1']),
      eventParticipantIds: new Set(['P1', 'P2', 'P3']),
      workshopRegistrations: 7,
    });
    expect(reach.map((entry) => entry.count)).toEqual([2, 1, 3, 7]);
  });
});

describe('engagementDepth', () => {
  it('counts how many domains each participant appears in', () => {
    const buckets = engagementDepth([
      new Set(['P1', 'P2', 'P3']),
      new Set(['P1', 'P2']),
      new Set(['P1']),
    ]);
    expect(buckets).toEqual([
      { key: '1', label: '1', value: 1 },
      { key: '2', label: '2', value: 1 },
      { key: '3', label: '3+', value: 1 },
    ]);
  });
});
