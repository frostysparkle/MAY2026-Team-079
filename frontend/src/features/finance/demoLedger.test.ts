import { describe, it, expect } from 'vitest';
import type { Event } from '@/api/types';
import {
  DEMO_TARIFF,
  buildDemoLedger,
  formatRupees,
  formatRupeesCompact,
  prizeLiabilityByType,
  summariseLedger,
  workshopSeatsFor,
  type LedgerInput,
} from './demoLedger';

const NOW = new Date('2026-08-18T12:00:00Z');

function input(overrides: Partial<LedgerInput> = {}): LedgerInput {
  return {
    messRosters: [],
    hostelRosters: [],
    eventRosters: [],
    workshopSeats: [],
    now: NOW,
    ...overrides,
  };
}

function eventWithPrizes(id: string, type: string, amounts: number[]): Event {
  return {
    event_id: id,
    event_type: type,
    name: id,
    description: '',
    team: { min: 1, max: 1, house_vs_house_event: false, allow_single_registration: true },
    prize_money: amounts.map((amount, index) => ({ position: `${index + 1}`, amount })),
    registration: {},
    schedule: [],
    registration_fields: [],
    event_team: [],
  };
}

describe('buildDemoLedger', () => {
  it('creates one transaction per real allocation', () => {
    const ledger = buildDemoLedger(
      input({
        messRosters: [{ id: 'M1', name: 'Alakananda', participantIds: ['P1', 'P2'] }],
        hostelRosters: [{ id: 'H1', name: 'Ganga', participantIds: ['P1'] }],
      }),
    );
    expect(ledger).toHaveLength(3);
    expect(ledger.filter((row) => row.purpose === 'mess')).toHaveLength(2);
    expect(ledger.filter((row) => row.purpose === 'hostel')).toHaveLength(1);
  });

  it('is deterministic — the same allocation always yields the same transaction', () => {
    // The board refreshes on a timer. A ledger reseeded per render would make
    // revenue flicker every sixty seconds, which reads as a live figure moving.
    const first = buildDemoLedger(
      input({ messRosters: [{ id: 'M1', name: 'A', participantIds: ['P1'] }] }),
    );
    const second = buildDemoLedger(
      input({ messRosters: [{ id: 'M1', name: 'A', participantIds: ['P1'] }] }),
    );
    expect(second).toEqual(first);
  });

  it('does not depend on the order rosters arrive in', () => {
    // The fan-out settles in whatever order the network returns, so a running
    // PRNG would give the same participant a different status run to run.
    const forwards = buildDemoLedger(
      input({ messRosters: [{ id: 'M1', name: 'A', participantIds: ['P1', 'P2'] }] }),
    );
    const backwards = buildDemoLedger(
      input({ messRosters: [{ id: 'M1', name: 'A', participantIds: ['P2', 'P1'] }] }),
    );
    const byId = (rows: typeof forwards) =>
      Object.fromEntries(rows.map((row) => [row.participant_id, row.status]));
    expect(byId(backwards)).toEqual(byId(forwards));
  });

  it('prices each purpose from the demo tariff', () => {
    const ledger = buildDemoLedger(
      input({
        messRosters: [{ id: 'M1', name: 'A', participantIds: ['P1'] }],
        workshopSeats: [{ id: 'W1', name: 'Robotics', registrations: 1 }],
      }),
    );
    expect(ledger.find((row) => row.purpose === 'mess')?.amount).toBe(DEMO_TARIFF.mess);
    expect(ledger.find((row) => row.purpose === 'workshop')?.amount).toBe(DEMO_TARIFF.workshop);
  });

  it('attributes workshop rows to seat numbers, since no roster exists', () => {
    // `GET /workshops` returns a count with no participant ids. Dressing that up
    // as a plausible participant id would make it indistinguishable from a real
    // one in the transactions table.
    const ledger = buildDemoLedger(
      input({ workshopSeats: [{ id: 'W1', name: 'Robotics', registrations: 2 }] }),
    );
    expect(ledger.map((row) => row.participant_id).sort()).toEqual(['SEAT-W1-1', 'SEAT-W1-2']);
  });

  it('returns newest first', () => {
    const ledger = buildDemoLedger(
      input({
        messRosters: [
          { id: 'M1', name: 'A', participantIds: Array.from({ length: 20 }, (_, i) => `P${i}`) },
        ],
      }),
    );
    const timestamps = ledger.map((row) => row.timestamp);
    expect([...timestamps].sort((a, b) => b.localeCompare(a))).toEqual(timestamps);
  });

  it('produces an empty ledger when nothing has been allotted', () => {
    expect(buildDemoLedger(input())).toEqual([]);
  });
});

describe('summariseLedger', () => {
  const ledger = buildDemoLedger(
    input({
      messRosters: [
        { id: 'M1', name: 'A', participantIds: Array.from({ length: 200 }, (_, i) => `P${i}`) },
      ],
    }),
  );
  const summary = summariseLedger(ledger, []);

  it('splits every transaction into exactly one status bucket', () => {
    expect(
      summary.paidCount + summary.pendingCount + summary.refundedCount + summary.failedCount,
    ).toBe(summary.transactionCount);
    expect(summary.transactionCount).toBe(200);
  });

  it('nets refunds out of revenue', () => {
    expect(summary.netRevenue).toBe(summary.collected - summary.refunded);
  });

  it('excludes refunds from the collection rate, which measures attempts', () => {
    const attempted = summary.collected + summary.pending + summary.failed;
    expect(summary.collectionRate).toBeCloseTo((summary.collected / attempted) * 100, 6);
  });

  it('reports the average settled transaction', () => {
    expect(summary.averageTicket).toBe(Math.round(summary.collected / summary.paidCount));
  });

  it('returns null rates for an empty ledger rather than zero', () => {
    const empty = summariseLedger([], []);
    expect(empty.collectionRate).toBeNull();
    expect(empty.averageTicket).toBeNull();
    expect(empty.netRevenue).toBe(0);
  });

  it('sums prize money from the real events, not the demo ledger', () => {
    const withPrizes = summariseLedger([], [eventWithPrizes('E1', 'technicals', [5000, 3000])]);
    expect(withPrizes.prizeLiability).toBe(8000);
  });
});

describe('prizeLiabilityByType', () => {
  it('groups by event type, largest first', () => {
    const byType = prizeLiabilityByType([
      eventWithPrizes('E1', 'technicals', [1000]),
      eventWithPrizes('E2', 'culturals', [5000]),
      eventWithPrizes('E3', 'technicals', [2000]),
    ]);
    expect(byType).toEqual([
      { type: 'culturals', amount: 5000 },
      { type: 'technicals', amount: 3000 },
    ]);
  });

  it('omits event types carrying no prize money', () => {
    expect(prizeLiabilityByType([eventWithPrizes('E1', 'technicals', [])])).toEqual([]);
  });
});

describe('workshopSeatsFor', () => {
  it('maps a workshop to its registration count', () => {
    const seats = workshopSeatsFor([
      {
        workshop_id: 'W1',
        slot_id: 'S1',
        name: 'Robotics',
        venue: 'Lab',
        capacity: 30,
        instructions: '',
        registration_count: 12,
        participant_count: 9,
      },
    ]);
    expect(seats).toEqual([{ id: 'W1', name: 'Robotics', registrations: 12 }]);
  });
});

describe('currency formatting', () => {
  it('groups digits the Indian way', () => {
    expect(formatRupees(123456)).toBe('₹1,23,456');
  });

  it('abbreviates large figures for headline tiles', () => {
    expect(formatRupeesCompact(1500)).toBe('₹1.5K');
    expect(formatRupeesCompact(250000)).toBe('₹2.5L');
    expect(formatRupeesCompact(15000000)).toBe('₹1.5Cr');
    expect(formatRupeesCompact(900)).toBe('₹900');
  });
});
