/**
 * A **demonstration** payment ledger for the Fest Control Board.
 *
 * ── What this is ────────────────────────────────────────────────────────────
 * The Paradox Connect backend has no payments domain: no fee on a mess hall or
 * hostel block, no transaction collection, no refund route, no revenue field.
 * The only `amount` in the whole API is `PrizeMoney.amount`, which is money the
 * fest pays out.
 *
 * So this module fabricates a ledger client-side so the Finance panel has
 * something to show. It is **not** a payment integration, it settles nothing,
 * and no figure it produces is a real financial record. Every surface that
 * renders it must say so — see `LEDGER_DISCLAIMER`.
 *
 * ── Why it is derived rather than random ────────────────────────────────────
 * The rows are built from the *real* rosters the board has already loaded: the
 * actual participants allotted to each mess hall and hostel block, the actual
 * registration counts per event and workshop. That makes the ledger move with
 * the fest — allocate 200 more beds and hostel revenue rises — which is the
 * whole point of showing it on a monitoring board. A random generator would
 * produce numbers that look plausible and mean nothing.
 *
 * ── Why it is deterministic ─────────────────────────────────────────────────
 * The board refreshes on a timer. A ledger reseeded per render would make
 * revenue flicker every 60 seconds, which on a dashboard reads as a live
 * figure changing rather than as noise. Every random choice here comes from a
 * hash of the transaction's own identity, so the same allocation always yields
 * the same transaction — status, method, amount, and timestamp included.
 */

import type { Event, Workshop } from '@/api/types';

/** Shown verbatim wherever a figure from this module is rendered. */
export const LEDGER_DISCLAIMER =
  'Demo data — the API records no payments. These transactions are generated from real allocations for demonstration only.';

export type PaymentPurpose = 'mess' | 'hostel' | 'event' | 'workshop';
export type PaymentStatus = 'paid' | 'pending' | 'refunded' | 'failed';
export type PaymentMethod = 'upi' | 'card' | 'netbanking' | 'wallet';

export interface DemoTransaction {
  /** Stable across refreshes — derived from the allocation, not from a counter. */
  transaction_id: string;
  participant_id: string;
  /** Whole rupees. Never fractional: the tariff below has no paise. */
  amount: number;
  purpose: PaymentPurpose;
  /** The mess_id, hostel_id, event_id, or workshop_id this pays for. */
  reference: string;
  /** What a human would read on a receipt, e.g. "Mess — Alakananda". */
  label: string;
  status: PaymentStatus;
  method: PaymentMethod;
  /** ISO 8601. */
  timestamp: string;
}

/**
 * The demo price list, in whole rupees. Deliberately a plain constant rather
 * than anything configurable: it is scenery, and pretending otherwise would
 * invite someone to treat it as a real tariff.
 */
export const DEMO_TARIFF: Record<PaymentPurpose, number> = {
  mess: 1200,
  hostel: 900,
  event: 150,
  workshop: 300,
};

/** Roughly how the demo population settles up. Must sum to 1. */
const STATUS_MIX: { status: PaymentStatus; share: number }[] = [
  { status: 'paid', share: 0.88 },
  { status: 'pending', share: 0.07 },
  { status: 'refunded', share: 0.03 },
  { status: 'failed', share: 0.02 },
];

const METHODS: PaymentMethod[] = ['upi', 'upi', 'upi', 'card', 'netbanking', 'wallet'];

export const PURPOSE_LABEL: Record<PaymentPurpose, string> = {
  mess: 'Mess',
  hostel: 'Hostel',
  event: 'Event',
  workshop: 'Workshop',
};

export const STATUS_LABEL: Record<PaymentStatus, string> = {
  paid: 'Paid',
  pending: 'Pending',
  refunded: 'Refunded',
  failed: 'Failed',
};

export const METHOD_LABEL: Record<PaymentMethod, string> = {
  upi: 'UPI',
  card: 'Card',
  netbanking: 'Net banking',
  wallet: 'Wallet',
};

/**
 * FNV-1a. A hash rather than a seeded sequence because each transaction must be
 * reproducible *independently* — rosters arrive in whatever order the fan-out
 * settles, and a running PRNG would assign different statuses to the same
 * participant depending on which hostel block responded first.
 */
function hash(key: string): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i += 1) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** A stable number in [0, 1) for one named facet of one transaction. */
function unit(key: string, facet: string): number {
  return hash(`${key}::${facet}`) / 4294967296;
}

function pickStatus(key: string): PaymentStatus {
  const roll = unit(key, 'status');
  let cumulative = 0;
  for (const entry of STATUS_MIX) {
    cumulative += entry.share;
    if (roll < cumulative) return entry.status;
  }
  return 'paid';
}

/**
 * Spread a transaction over the two weeks before `reference`, weighted toward
 * the recent end — sign-ups cluster as a fest approaches rather than arriving
 * uniformly, and a flat spread makes the revenue trend look synthetic.
 */
function timestampFor(key: string, reference: Date): string {
  const roll = unit(key, 'when');
  const daysBack = Math.floor(roll * roll * 14);
  const minutes = Math.floor(unit(key, 'minute') * 1440);
  const at = new Date(reference);
  at.setDate(at.getDate() - daysBack);
  at.setHours(0, minutes, 0, 0);
  return at.toISOString();
}

function makeTransaction(
  participantId: string,
  purpose: PaymentPurpose,
  reference: string,
  label: string,
  now: Date,
): DemoTransaction {
  const key = `${purpose}:${reference}:${participantId}`;
  const id = hash(key).toString(36).toUpperCase().padStart(7, '0');
  return {
    transaction_id: `PDX-${PURPOSE_LABEL[purpose].slice(0, 2).toUpperCase()}-${id}`,
    participant_id: participantId,
    amount: DEMO_TARIFF[purpose],
    purpose,
    reference,
    label,
    status: pickStatus(key),
    method: METHODS[hash(`${key}::method`) % METHODS.length],
    timestamp: timestampFor(key, now),
  };
}

/**
 * The rosters and counts the ledger is built from. Every field is optional-ish
 * in practice: a statistics call that failed contributes nothing rather than
 * blanking the ledger, matching how the rest of the board degrades.
 */
export interface LedgerInput {
  /** Real allotted participants per mess hall, from `/mess/{id}/statistics`. */
  messRosters: { id: string; name: string; participantIds: string[] }[];
  /** Real allotted participants per hostel block. */
  hostelRosters: { id: string; name: string; participantIds: string[] }[];
  /** Real participants per event, from `/events/{id}/participation`. */
  eventRosters: { id: string; name: string; participantIds: string[] }[];
  /**
   * Workshops carry only a count, never a roster — `GET /workshops` returns
   * `registration_count` with no participant ids — so these rows are attributed
   * to synthetic seat numbers rather than to real people.
   */
  workshopSeats: { id: string; name: string; registrations: number }[];
  /** Injected so tests are not clock-dependent. */
  now?: Date;
}

/** Build the full demo ledger. Pure, and stable for identical input. */
export function buildDemoLedger(input: LedgerInput): DemoTransaction[] {
  const now = input.now ?? new Date();
  const rows: DemoTransaction[] = [];

  for (const hall of input.messRosters) {
    for (const pid of hall.participantIds) {
      rows.push(makeTransaction(pid, 'mess', hall.id, `Mess — ${hall.name}`, now));
    }
  }
  for (const block of input.hostelRosters) {
    for (const pid of block.participantIds) {
      rows.push(makeTransaction(pid, 'hostel', block.id, `Hostel — ${block.name}`, now));
    }
  }
  for (const event of input.eventRosters) {
    for (const pid of event.participantIds) {
      rows.push(makeTransaction(pid, 'event', event.id, `Event — ${event.name}`, now));
    }
  }
  for (const workshop of input.workshopSeats) {
    for (let seat = 0; seat < workshop.registrations; seat += 1) {
      // No roster exists, so the "participant" is a seat number. Named as such
      // rather than dressed up as a plausible participant id, which would be
      // indistinguishable from a real one in the transactions table.
      rows.push(
        makeTransaction(
          `SEAT-${workshop.id}-${seat + 1}`,
          'workshop',
          workshop.id,
          `Workshop — ${workshop.name}`,
          now,
        ),
      );
    }
  }

  return rows.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
}

/* ------------------------------------------------------------- summaries --- */

export interface FinanceSummary {
  /** Settled money in, i.e. `paid` less `refunded`. */
  netRevenue: number;
  collected: number;
  pending: number;
  refunded: number;
  failed: number;
  transactionCount: number;
  paidCount: number;
  pendingCount: number;
  refundedCount: number;
  failedCount: number;
  /** Collected ÷ (collected + pending + failed), as a percent. */
  collectionRate: number | null;
  /** Average settled value per paying participant. */
  averageTicket: number | null;
  byPurpose: { purpose: PaymentPurpose; collected: number; count: number }[];
  /** Collected per day, chronological — the revenue trend. */
  byDay: { day: string; collected: number }[];
  /** Committed prize money. The one genuinely real figure in this panel. */
  prizeLiability: number;
}

function sumAmounts(rows: DemoTransaction[]): number {
  return rows.reduce((total, row) => total + row.amount, 0);
}

/**
 * Aggregate a ledger, plus the one real money figure available anywhere in the
 * API: total committed prize money across every event's `prize_money[]`.
 */
export function summariseLedger(rows: DemoTransaction[], events: Event[]): FinanceSummary {
  const paid = rows.filter((r) => r.status === 'paid');
  const pending = rows.filter((r) => r.status === 'pending');
  const refunded = rows.filter((r) => r.status === 'refunded');
  const failed = rows.filter((r) => r.status === 'failed');

  const collected = sumAmounts(paid);
  const refundedTotal = sumAmounts(refunded);
  const pendingTotal = sumAmounts(pending);
  const failedTotal = sumAmounts(failed);

  const attemptedTotal = collected + pendingTotal + failedTotal;

  const byPurpose = (Object.keys(DEMO_TARIFF) as PaymentPurpose[]).map((purpose) => {
    const forPurpose = paid.filter((r) => r.purpose === purpose);
    return { purpose, collected: sumAmounts(forPurpose), count: forPurpose.length };
  });

  const dayTotals = new Map<string, number>();
  for (const row of paid) {
    const day = row.timestamp.slice(0, 10);
    dayTotals.set(day, (dayTotals.get(day) ?? 0) + row.amount);
  }

  return {
    netRevenue: collected - refundedTotal,
    collected,
    pending: pendingTotal,
    refunded: refundedTotal,
    failed: failedTotal,
    transactionCount: rows.length,
    paidCount: paid.length,
    pendingCount: pending.length,
    refundedCount: refunded.length,
    failedCount: failed.length,
    collectionRate: attemptedTotal > 0 ? (collected / attemptedTotal) * 100 : null,
    averageTicket: paid.length > 0 ? Math.round(collected / paid.length) : null,
    byPurpose: byPurpose.sort((a, b) => b.collected - a.collected),
    byDay: [...dayTotals.entries()]
      .map(([day, collectedOnDay]) => ({ day, collected: collectedOnDay }))
      .sort((a, b) => a.day.localeCompare(b.day)),
    prizeLiability: events.reduce(
      (total, event) =>
        total + (event.prize_money ?? []).reduce((sum, prize) => sum + (prize.amount ?? 0), 0),
      0,
    ),
  };
}

/** Committed prize money per event type, largest first. */
export function prizeLiabilityByType(events: Event[]): { type: string; amount: number }[] {
  const totals = new Map<string, number>();
  for (const event of events) {
    const amount = (event.prize_money ?? []).reduce((sum, prize) => sum + (prize.amount ?? 0), 0);
    if (amount > 0) totals.set(event.event_type, (totals.get(event.event_type) ?? 0) + amount);
  }
  return [...totals.entries()]
    .map(([type, amount]) => ({ type, amount }))
    .sort((a, b) => b.amount - a.amount);
}

/** Workshops contribute seat counts, never a roster. Kept here so the panel and the ledger agree. */
export function workshopSeatsFor(workshops: Workshop[]): LedgerInput['workshopSeats'] {
  return workshops.map((w) => ({
    id: w.workshop_id,
    name: w.name,
    registrations: w.registration_count,
  }));
}

/** `₹1,23,456` — Indian digit grouping, which is what the rest of the fest uses. */
export function formatRupees(amount: number): string {
  return `₹${amount.toLocaleString('en-IN')}`;
}

/** `₹1.2L` / `₹12.3K` for headline tiles, where the full figure will not fit. */
export function formatRupeesCompact(amount: number): string {
  if (Math.abs(amount) >= 10000000) return `₹${(amount / 10000000).toFixed(1)}Cr`;
  if (Math.abs(amount) >= 100000) return `₹${(amount / 100000).toFixed(1)}L`;
  if (Math.abs(amount) >= 1000) return `₹${(amount / 1000).toFixed(1)}K`;
  return `₹${amount}`;
}
