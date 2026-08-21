import type { QueryRecord, StaffIssue } from '@/api/types';
import {
  FAULT_CLUSTER_THRESHOLD,
  STALE_FAULT_HOURS,
  STALE_QUERY_HOURS,
  placeList,
  summariseSupport,
} from './supportMetrics';

/**
 * The support backlog summariser — what feeds the alert rail's support rules.
 *
 * The point of every assertion here is that a *failed read* and an *empty queue*
 * produce different answers. A board that cannot tell them apart reports "nothing
 * waiting" when the request 500ed, which is the one failure mode this dashboard is
 * built to avoid.
 */

const NOW = new Date('2026-06-10T18:00:00.000Z');

/** Backend timestamps arrive naive, so these deliberately carry no offset. */
function hoursAgo(hours: number): string {
  return new Date(NOW.getTime() - hours * 3_600_000).toISOString().replace('Z', '');
}

function query(over: Partial<QueryRecord> = {}): QueryRecord {
  return {
    query_id: 'QRY1',
    participant_id: 'DS23F1000001',
    participant_name: 'Asha Rao',
    participant_house: 'Nilgiri House',
    category: 'hostel',
    target_id: 'H12',
    subject: 'Late entry',
    body: 'Is the gate open after midnight?',
    status: 'open',
    assigned_team: null,
    assigned_to: null,
    replies: [],
    created_at: hoursAgo(1),
    updated_at: hoursAgo(1),
    resolved_at: null,
    ...over,
  };
}

function staffReply() {
  return {
    author_id: 'BT1',
    author_type: 'staff' as const,
    author_name: 'Block desk',
    body: 'Yes, all night.',
    timestamp: hoursAgo(1),
  };
}

function issue(over: Partial<StaffIssue> = {}): StaffIssue {
  return {
    issue_id: 'ISS1',
    facility_type: 'hostel',
    facility_id: 'Ganga Block',
    category: 'water',
    subject: 'No hot water',
    body: 'Geyser off since morning.',
    room: '101',
    status: 'open',
    created_at: hoursAgo(1),
    updated_at: hoursAgo(1),
    updates: [],
    reporter: {
      participant_id: 'DS23F1000001',
      name: 'Asha Rao',
      phone: '9876500001',
      room: '101',
    },
    ...over,
  };
}

describe('summariseSupport', () => {
  it('counts nothing as null when both reads failed', () => {
    const summary = summariseSupport(null, null, NOW);
    expect(summary.outstandingQueries).toBeNull();
    expect(summary.openFaults).toBeNull();
    expect(summary.waiting).toBeNull();
  });

  it('distinguishes an empty queue from a failed read', () => {
    const empty = summariseSupport([], [], NOW);
    expect(empty.outstandingQueries).toBe(0);
    expect(empty.openFaults).toBe(0);
    expect(empty.waiting).toBe(0);
  });

  it('keeps waiting null when only one of the two reads failed', () => {
    // A partial total that looks complete is worse than no total.
    expect(summariseSupport([query()], null, NOW).waiting).toBeNull();
    expect(summariseSupport(null, [issue()], NOW).waiting).toBeNull();
    // ...but the half that *did* load is still reported.
    expect(summariseSupport([query()], null, NOW).outstandingQueries).toBe(1);
    expect(summariseSupport(null, [issue()], NOW).openFaults).toBe(1);
  });

  it('excludes resolved work from every outstanding figure', () => {
    const summary = summariseSupport(
      [query({ status: 'resolved' })],
      [issue({ status: 'resolved' })],
      NOW,
    );
    expect(summary.outstandingQueries).toBe(0);
    expect(summary.unansweredQueries).toBe(0);
    expect(summary.openFaults).toBe(0);
    expect(summary.waiting).toBe(0);
  });

  it('counts a claimed-but-unreplied query as unanswered', () => {
    // The failure a status column cannot show: somebody took it and went quiet.
    const summary = summariseSupport([query({ status: 'assigned', assigned_to: 'BT1' })], [], NOW);
    expect(summary.outstandingQueries).toBe(1);
    expect(summary.unansweredQueries).toBe(1);
  });

  it('does not count a query a staff member has replied to as unanswered', () => {
    const summary = summariseSupport([query({ replies: [staffReply()] })], [], NOW);
    expect(summary.outstandingQueries).toBe(1);
    expect(summary.unansweredQueries).toBe(0);
  });

  it('treats a naive backend timestamp as UTC rather than local', () => {
    // Without the Z the age is 5½ hours out in India, which is the difference
    // between "stale" and "just raised" for anything near the boundary.
    const summary = summariseSupport([query({ created_at: hoursAgo(1) })], [], NOW);
    expect(summary.stalledQueries).toBe(0);
  });

  it('stalls a query exactly at the threshold, not just below it', () => {
    expect(
      summariseSupport([query({ created_at: hoursAgo(STALE_QUERY_HOURS - 0.1) })], [], NOW)
        .stalledQueries,
    ).toBe(0);
    expect(
      summariseSupport([query({ created_at: hoursAgo(STALE_QUERY_HOURS) })], [], NOW)
        .stalledQueries,
    ).toBe(1);
  });

  it('does not stall an old query that has been answered', () => {
    const summary = summariseSupport(
      [query({ created_at: hoursAgo(STALE_QUERY_HOURS + 48), replies: [staffReply()] })],
      [],
      NOW,
    );
    expect(summary.stalledQueries).toBe(0);
  });

  it('declines to age a query whose timestamp is not a date', () => {
    // A rule that cannot tell how old something is must not call it overdue.
    const summary = summariseSupport([query({ created_at: 'not a date' })], [], NOW);
    expect(summary.unansweredQueries).toBe(1);
    expect(summary.stalledQueries).toBe(0);
  });

  it('measures a fault from updated_at, so a note resets the clock', () => {
    const forgotten = issue({
      created_at: hoursAgo(STALE_FAULT_HOURS + 10),
      updated_at: hoursAgo(STALE_FAULT_HOURS + 10),
    });
    const acknowledged = issue({
      issue_id: 'ISS2',
      created_at: hoursAgo(STALE_FAULT_HOURS + 10),
      // A team said "part ordered" an hour ago.
      updated_at: hoursAgo(1),
      status: 'in_progress',
    });
    const summary = summariseSupport([], [forgotten, acknowledged], NOW);
    expect(summary.openFaults).toBe(2);
    expect(summary.stalledFaults).toBe(1);
  });

  it('stalls a fault exactly at the threshold, not just below it', () => {
    expect(
      summariseSupport([], [issue({ updated_at: hoursAgo(STALE_FAULT_HOURS - 0.1) })], NOW)
        .stalledFaults,
    ).toBe(0);
    expect(
      summariseSupport([], [issue({ updated_at: hoursAgo(STALE_FAULT_HOURS) })], NOW).stalledFaults,
    ).toBe(1);
  });

  it('picks out a safety fault, whatever its age', () => {
    const summary = summariseSupport([], [issue({ category: 'safety' })], NOW);
    expect(summary.urgentFaults).toEqual([
      { facilityType: 'hostel', facilityId: 'Ganga Block', count: 1 },
    ]);
  });

  it('does not treat a resolved safety fault as urgent', () => {
    const summary = summariseSupport([], [issue({ category: 'safety', status: 'resolved' })], NOW);
    expect(summary.urgentFaults).toEqual([]);
  });

  it('clusters a place only once it reaches the threshold', () => {
    const below = Array.from({ length: FAULT_CLUSTER_THRESHOLD - 1 }, (_, i) =>
      issue({ issue_id: `ISS${i}` }),
    );
    expect(summariseSupport([], below, NOW).clusters).toEqual([]);

    const at = Array.from({ length: FAULT_CLUSTER_THRESHOLD }, (_, i) =>
      issue({ issue_id: `ISS${i}` }),
    );
    expect(summariseSupport([], at, NOW).clusters).toEqual([
      { facilityType: 'hostel', facilityId: 'Ganga Block', count: FAULT_CLUSTER_THRESHOLD },
    ]);
  });

  it('keeps a hostel and a hall with the same id apart', () => {
    const rows = [
      ...Array.from({ length: FAULT_CLUSTER_THRESHOLD }, (_, i) =>
        issue({ issue_id: `H${i}`, facility_type: 'hostel', facility_id: 'A' }),
      ),
      ...Array.from({ length: FAULT_CLUSTER_THRESHOLD }, (_, i) =>
        issue({ issue_id: `M${i}`, facility_type: 'mess', facility_id: 'A', category: 'hygiene' }),
      ),
    ];
    const clusters = summariseSupport([], rows, NOW).clusters;
    expect(clusters).toHaveLength(2);
    expect(clusters.map((c) => c.facilityType).sort()).toEqual(['hostel', 'mess']);
  });

  it('ranks the worst place first', () => {
    const rows = [
      ...Array.from({ length: 5 }, (_, i) => issue({ issue_id: `A${i}`, facility_id: 'Kaveri' })),
      ...Array.from({ length: 3 }, (_, i) => issue({ issue_id: `B${i}`, facility_id: 'Ganga' })),
    ];
    expect(summariseSupport([], rows, NOW).clusters.map((c) => c.facilityId)).toEqual([
      'Kaveri',
      'Ganga',
    ]);
  });

  it('adds both queues into waiting', () => {
    const summary = summariseSupport(
      [query(), query({ query_id: 'QRY2' })],
      [issue(), issue({ issue_id: 'ISS2' }), issue({ issue_id: 'ISS3' })],
      NOW,
    );
    expect(summary.waiting).toBe(5);
  });
});

describe('placeList', () => {
  it('names the places, not their types', () => {
    expect(
      placeList([
        { facilityType: 'hostel', facilityId: 'Ganga Block', count: 3 },
        { facilityType: 'mess', facilityId: 'Hall C', count: 4 },
      ]),
    ).toBe('Ganga Block, Hall C');
  });

  it('is empty for an empty list', () => {
    expect(placeList([])).toBe('');
  });
});
