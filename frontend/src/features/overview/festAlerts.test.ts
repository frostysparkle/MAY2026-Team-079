import { describe, it, expect } from 'vitest';
import {
  BACKLOG_THRESHOLD,
  PRESSURE_THRESHOLD,
  buildAlerts,
  type AlertInput,
  type AlertRoutes,
} from './festAlerts';
import type { HostelRow, HostelSummary } from '@/features/hostels/hostelOccupancy';
import type { MessRow, MessSummary } from '@/features/mess/messOccupancy';
import type { EventSummary, StaffOpsSummary, WorkshopSummary } from './festMetrics';
import { SUPPORT_BACKLOG_THRESHOLD, type SupportSummary } from './supportMetrics';

const ROUTES: AlertRoutes = {
  hostels: '/staff/admin/hostels',
  mess: '/staff/admin/mess',
  events: '/staff/admin/events',
  workshops: '/staff/admin/workshops',
  staff: '/staff/admin/backend-teams',
  auditLogs: '/staff/admin/audit-logs',
  queries: '/staff/queries',
  issues: '/staff/issues',
};

function hostelSummary(over: Partial<HostelSummary> = {}): HostelSummary {
  return {
    hostels: 2,
    beds: 200,
    byCategory: [],
    staffed: 2,
    occupied: 1,
    allocated: 100,
    available: 100,
    percent: 50,
    ...over,
  };
}

function messSummary(over: Partial<MessSummary> = {}): MessSummary {
  return {
    halls: 2,
    seats: 200,
    byType: [],
    staffed: 2,
    occupied: 1,
    allocated: 100,
    available: 100,
    percent: 50,
    ...over,
  };
}

function eventSummary(over: Partial<EventSummary> = {}): EventSummary {
  return {
    total: 3,
    open: 3,
    closed: 0,
    live: 0,
    upcoming: 3,
    past: 0,
    unscheduled: 0,
    registrations: 30,
    scansToday: 0,
    turnoutToday: null,
    turnoutEvents: 0,
    withoutRegistrations: [],
    topByRegistrations: [],
    liveNow: [],
    startingSoon: [],
    withCapacity: 0,
    gateEntriesLeft: null,
    gateAtCapacity: [],
    gateNearCapacity: [],
    demandAtCapacity: [],
    ...over,
  };
}

function workshopSummary(over: Partial<WorkshopSummary> = {}): WorkshopSummary {
  return {
    total: 2,
    capacity: 60,
    registrations: 30,
    attended: 25,
    seatsLeft: 30,
    fillPercent: 50,
    showRate: 83,
    soldOut: 0,
    empty: 0,
    poorTurnout: [],
    fullest: [],
    ...over,
  };
}

function staffSummary(over: Partial<StaffOpsSummary> = {}): StaffOpsSummary {
  return {
    accounts: 5,
    activeToday: 3,
    assigned: 5,
    unassigned: 0,
    mutedAssignments: 0,
    staffWithMuted: [],
    workloadBuckets: [],
    byDepartment: [],
    busiest: [],
    ...over,
  };
}

/**
 * A quiet support desk by default.
 *
 * Zeroes rather than nulls, because "read it, nothing waiting" is the healthy
 * state these rules are measured against; the unreadable case is asserted
 * separately with nulls.
 */
function support(over: Partial<SupportSummary> = {}): SupportSummary {
  return {
    outstandingQueries: 0,
    unansweredQueries: 0,
    stalledQueries: 0,
    openFaults: 0,
    stalledFaults: 0,
    urgentFaults: [],
    clusters: [],
    waiting: 0,
    ...over,
  };
}

/** A row shaped enough for the alert rules, which only read name/percent/capacity. */
function row(name: string, capacity: number, allocated: number | null) {
  const percent = allocated === null || capacity === 0 ? null : (allocated / capacity) * 100;
  return { name, capacity, allocated, percent } as unknown as HostelRow & MessRow;
}

function input(over: Partial<AlertInput> = {}): AlertInput {
  return {
    hostels: { summary: hostelSummary(), rows: [], pending: 0 },
    mess: { summary: messSummary(), rows: [], scansLast20Min: 5 },
    events: eventSummary(),
    workshops: workshopSummary(),
    staff: staffSummary(),
    pulse: { lastHour: 5, baseline: 4, spiking: false },
    failedDomains: [],
    ...over,
  };
}

const idsOf = (over: Partial<AlertInput> = {}) => buildAlerts(input(over), ROUTES).map((a) => a.id);

describe('buildAlerts', () => {
  it('reports nothing when the fest is healthy', () => {
    expect(idsOf()).toEqual([]);
  });

  it('sorts critical before warning before attention before info', () => {
    const alerts = buildAlerts(
      input({
        hostels: { summary: hostelSummary({ available: 0 }), rows: [], pending: 40 },
        staff: staffSummary({ unassigned: 2 }),
        failedDomains: ['events'],
      }),
      ROUTES,
    );
    expect(alerts.map((a) => a.severity)).toEqual(['critical', 'warning', 'attention', 'info']);
  });
});

describe('critical rules', () => {
  it('fires when the campus is full and people are still waiting', () => {
    expect(
      idsOf({ hostels: { summary: hostelSummary({ available: 0 }), rows: [], pending: 5 } }),
    ).toContain('hostel-campus-full');
  });

  it('does not fire when the campus is full but the queue is empty', () => {
    expect(
      idsOf({ hostels: { summary: hostelSummary({ available: 0 }), rows: [], pending: 0 } }),
    ).not.toContain('hostel-campus-full');
  });

  it('fires when a hall is over capacity, not merely at it', () => {
    expect(
      idsOf({ mess: { summary: messSummary(), rows: [row('A', 100, 101)], scansLast20Min: 5 } }),
    ).toContain('mess-over-capacity');
    expect(
      idsOf({ mess: { summary: messSummary(), rows: [row('A', 100, 100)], scansLast20Min: 5 } }),
    ).not.toContain('mess-over-capacity');
  });

  it('fires on a muted scanner only while something is live', () => {
    // Off-hours a disabled scanner is a configuration note. During a live event
    // it is an outage: the volunteer gets a 403 and the queue backs up.
    expect(
      idsOf({ events: eventSummary({ live: 1 }), staff: staffSummary({ mutedAssignments: 2 }) }),
    ).toContain('scanners-muted-during-live-event');
    expect(
      idsOf({ events: eventSummary({ live: 0 }), staff: staffSummary({ mutedAssignments: 2 }) }),
    ).not.toContain('scanners-muted-during-live-event');
  });

  it('fires on a single unresolved safety fault, with no threshold to cross', () => {
    // One is enough: this is "somebody is in it now", not "this will get worse".
    expect(
      idsOf({
        support: support({
          urgentFaults: [{ facilityType: 'hostel', facilityId: 'Ganga Block', count: 1 }],
        }),
      }),
    ).toContain('support-urgent-faults');
  });

  it('names the place a safety fault was reported at', () => {
    const alert = buildAlerts(
      input({
        support: support({
          urgentFaults: [{ facilityType: 'hostel', facilityId: 'Ganga Block', count: 1 }],
        }),
      }),
      ROUTES,
    ).find((a) => a.id === 'support-urgent-faults');
    expect(alert?.detail).toContain('Ganga Block');
    expect(alert?.action?.to).toBe(ROUTES.issues);
  });
});

describe('support rules', () => {
  it('reports nothing when both queues are quiet', () => {
    expect(idsOf({ support: support() })).toEqual([]);
  });

  it('reports nothing when both queues could not be read', () => {
    // A failed read is not a backlog: nulls must fire no rule at all, rather
    // than being coerced to 0 and read as a healthy desk or to NaN and compared.
    const unreadable = support({
      outstandingQueries: null,
      unansweredQueries: null,
      stalledQueries: null,
      openFaults: null,
      stalledFaults: null,
      waiting: null,
    });
    expect(idsOf({ support: unreadable })).toEqual([]);
  });

  it('reports nothing when the caller passes no support figures at all', () => {
    // `support` is optional on AlertInput, so an older caller still compiles and
    // simply raises no support rows.
    expect(idsOf({ support: null })).toEqual([]);
    expect(idsOf({})).toEqual([]);
  });

  it('warns about a query nobody has replied to, and links to the query desk', () => {
    const alert = buildAlerts(input({ support: support({ stalledQueries: 3 }) }), ROUTES).find(
      (a) => a.id === 'support-stalled-queries',
    );
    expect(alert?.severity).toBe('warning');
    expect(alert?.title).toContain('3 queries');
    expect(alert?.action?.to).toBe(ROUTES.queries);
  });

  it('warns about a fault nobody has touched, and links to the issues desk', () => {
    const alert = buildAlerts(input({ support: support({ stalledFaults: 1 }) }), ROUTES).find(
      (a) => a.id === 'support-stalled-faults',
    );
    expect(alert?.severity).toBe('warning');
    expect(alert?.title).toContain('1 reported fault has');
    expect(alert?.action?.to).toBe(ROUTES.issues);
  });

  it('names the backlog only once it is worth naming', () => {
    // A busy support desk is what a running fest looks like, so this is
    // `attention` and it waits for a real volume.
    expect(
      idsOf({
        support: support({
          outstandingQueries: SUPPORT_BACKLOG_THRESHOLD - 1,
          openFaults: 0,
          waiting: SUPPORT_BACKLOG_THRESHOLD - 1,
        }),
      }),
    ).not.toContain('support-backlog');

    const alert = buildAlerts(
      input({
        support: support({
          outstandingQueries: SUPPORT_BACKLOG_THRESHOLD - 2,
          openFaults: 2,
          waiting: SUPPORT_BACKLOG_THRESHOLD,
        }),
      }),
      ROUTES,
    ).find((a) => a.id === 'support-backlog');
    expect(alert?.severity).toBe('attention');
    expect(alert?.detail).toContain('2 open faults');
  });

  it('flags a place carrying several faults, which occupancy alerting cannot see', () => {
    // A block whose showers are all broken is at a perfectly normal occupancy.
    const alert = buildAlerts(
      input({
        support: support({
          clusters: [
            { facilityType: 'hostel', facilityId: 'Kaveri', count: 5 },
            { facilityType: 'mess', facilityId: 'Hall C', count: 3 },
          ],
        }),
      }),
      ROUTES,
    ).find((a) => a.id === 'support-fault-clusters');
    expect(alert?.severity).toBe('attention');
    expect(alert?.detail).toContain('Kaveri (5)');
    expect(alert?.detail).toContain('Hall C (3)');
  });

  it('keeps a support backlog out of the capacity alerting it is not', () => {
    // 9.2's rail ranks on occupancy; a fault outbreak must not be escalated into
    // a bed-shortage alert.
    const ids = idsOf({
      support: support({
        stalledFaults: 4,
        clusters: [{ facilityType: 'hostel', facilityId: 'Kaveri', count: 9 }],
      }),
    });
    expect(ids).not.toContain('hostel-campus-full');
    expect(ids).not.toContain('capacity-pressure');
  });
});

describe('warning rules', () => {
  it('fires the backlog rule at the threshold, not below it', () => {
    const at = idsOf({
      hostels: { summary: hostelSummary(), rows: [], pending: BACKLOG_THRESHOLD },
    });
    const below = idsOf({
      hostels: { summary: hostelSummary(), rows: [], pending: BACKLOG_THRESHOLD - 1 },
    });
    expect(at).toContain('accommodation-backlog');
    expect(below).not.toContain('accommodation-backlog');
  });

  it('fires capacity pressure at the threshold but not once full', () => {
    // A full block is already reported by the critical rules; repeating it here
    // would push the real problem down the strip.
    const pressured = row('A', 100, PRESSURE_THRESHOLD);
    const full = row('B', 100, 100);
    expect(
      idsOf({ hostels: { summary: hostelSummary(), rows: [pressured], pending: 0 } }),
    ).toContain('capacity-pressure');
    expect(
      idsOf({ hostels: { summary: hostelSummary(), rows: [full], pending: 0 } }),
    ).not.toContain('capacity-pressure');
  });

  it('ignores rows whose occupancy could not be read', () => {
    expect(
      idsOf({ hostels: { summary: hostelSummary(), rows: [row('A', 100, null)], pending: 0 } }),
    ).not.toContain('capacity-pressure');
  });

  it('fires on silent meal service only once the trail has loaded', () => {
    // Before the fetch lands, "zero scans in twenty minutes" is a statement
    // about the request, not about the fest.
    expect(idsOf({ mess: { summary: messSummary(), rows: [], scansLast20Min: 0 } })).toContain(
      'mess-service-silent',
    );
    expect(
      idsOf({ mess: { summary: messSummary(), rows: [], scansLast20Min: null } }),
    ).not.toContain('mess-service-silent');
  });

  it('fires on workshops with collapsed turnout', () => {
    const poor = [{ name: 'Robotics' }] as WorkshopSummary['poorTurnout'];
    expect(idsOf({ workshops: workshopSummary({ poorTurnout: poor }) })).toContain(
      'workshop-turnout',
    );
  });
});

describe('attention rules', () => {
  it('names events with no registrations', () => {
    const empty = [{ name: 'Quiz' }] as EventSummary['withoutRegistrations'];
    const alerts = buildAlerts(
      input({ events: eventSummary({ withoutRegistrations: empty }) }),
      ROUTES,
    );
    const alert = alerts.find((a) => a.id === 'events-without-registrations');
    expect(alert?.detail).toContain('Quiz');
  });

  it('reports unassigned staff', () => {
    expect(idsOf({ staff: staffSummary({ unassigned: 3 }) })).toContain('unassigned-staff');
  });

  it('reports an activity spike only when the pulse says so', () => {
    expect(idsOf({ pulse: { lastHour: 40, baseline: 4, spiking: true } })).toContain(
      'activity-spike',
    );
    expect(idsOf({ pulse: { lastHour: 40, baseline: 4, spiking: false } })).not.toContain(
      'activity-spike',
    );
  });
});

describe('partial data notice', () => {
  it('is raised whenever anything failed to load', () => {
    // The row that keeps the rest trustworthy: without it a partial total is
    // indistinguishable from a real one.
    const alerts = buildAlerts(input({ failedDomains: ['events', 'staff roster'] }), ROUTES);
    const notice = alerts.find((a) => a.id === 'partial-data');
    expect(notice?.severity).toBe('info');
    expect(notice?.detail).toContain('events');
    expect(notice?.detail).toContain('staff roster');
  });

  it('is absent when everything loaded', () => {
    expect(idsOf({ failedDomains: [] })).not.toContain('partial-data');
  });
});

describe('alert actions', () => {
  it('links every actionable alert to a route the board can hand off to', () => {
    const alerts = buildAlerts(
      input({ hostels: { summary: hostelSummary({ available: 0 }), rows: [], pending: 5 } }),
      ROUTES,
    );
    const routes = Object.values(ROUTES);
    for (const alert of alerts) {
      if (alert.action) expect(routes).toContain(alert.action.to);
    }
  });
});
