/**
 * The student's Accommodation & Mess selection, and the receipt for the dummy
 * payment that confirmed it.
 *
 * ── Why this lives on the device ────────────────────────────────────────────
 * Only half of this selection has somewhere to go on the server. Accommodation
 * does: `POST /hostels/register` sets `accommodation.registered`, which is the
 * exact flag `POST /hostels/allocate` filters on, so opting in is a real,
 * server-side act and the page reads it back from `GET /hostels/my_hostel`.
 *
 * The mess half has no such route. `mess.registered` exists on the participant
 * document and nothing in the API ever writes it — `POST /mess/allocate` places
 * every participant who has no `mess.mess_id` yet, opt-in or not. And there is
 * no payments domain at all: no fee on a block or a hall, no transaction
 * collection, no receipt. So the mess intent and the payment record are kept
 * here, keyed per participant, and every surface that renders them says the
 * payment is a mock (see `PAYMENT_DISCLAIMER`).
 *
 * Anything the backend *does* know stays authoritative: where a record here
 * disagrees with `my_hostel` / `my_mess`, the server wins.
 *
 * Prices come from `DEMO_TARIFF` rather than a second list of their own, so the
 * fee a student is charged is the same figure the admin board's demo ledger
 * bills them for.
 */
import { DEMO_TARIFF, formatRupees } from '@/features/finance/demoLedger';
import type { MockPaymentResponse } from '@/api/types';

/** One bookable facility. */
export type StayFacility = 'accommodation' | 'mess';

/** What the student picks on the Accommodation & Mess screen. */
export type StayChoice = 'both' | 'accommodation' | 'mess' | 'neither';

export const STAY_CHOICES: readonly StayChoice[] = ['both', 'accommodation', 'mess', 'neither'];

/** Which facilities each choice covers. `neither` covers none. */
export const CHOICE_FACILITIES: Record<StayChoice, readonly StayFacility[]> = {
  both: ['accommodation', 'mess'],
  accommodation: ['accommodation'],
  mess: ['mess'],
  neither: [],
};

export const CHOICE_LABEL: Record<StayChoice, string> = {
  both: 'Accommodation and mess',
  accommodation: 'Accommodation only',
  mess: 'Mess only',
  neither: 'Neither',
};

export const CHOICE_DESCRIPTION: Record<StayChoice, string> = {
  both: 'A hostel bed for the fest, and all three meals a day at your allotted hall.',
  accommodation: 'A hostel bed for the fest. You arrange your own meals.',
  mess: 'All three meals a day at your allotted hall. You arrange your own stay.',
  neither: 'You are commuting and eating off campus. Nothing to pay.',
};

export const FACILITY_LABEL: Record<StayFacility, string> = {
  accommodation: 'Hostel accommodation',
  mess: 'Mess — all meals',
};

/** Whole rupees per facility, taken from the fest's one demo price list. */
export const FACILITY_FEE: Record<StayFacility, number> = {
  accommodation: DEMO_TARIFF.hostel,
  mess: DEMO_TARIFF.mess,
};

/** Shown verbatim wherever a figure from this module is rendered. */
export const PAYMENT_DISCLAIMER =
  'Mock payment — the Paradox Connect API records no transactions. No card details are collected and no money moves.';

export interface StayLineItem {
  facility: StayFacility;
  label: string;
  amount: number;
}

export interface StayReceipt {
  /**
   * The real transaction reference(s) `POST /hostels/pay` / `POST /mess/pay`
   * returned, e.g. `PDX-HOSTEL-A1B2C3D4`. A `both` booking pays each facility
   * separately, so this joins both ids with ` · ` rather than picking one.
   */
  reference: string;
  /** `upi` | `card` | `netbanking` — the same vocabulary as the demo ledger. */
  method: string;
  /** ISO 8601. */
  paid_at: string;
  items: StayLineItem[];
  total: number;
}

export interface StayRecord {
  choice: StayChoice;
  /** ISO 8601 — when the student made the selection. */
  decided_at: string;
  /** Null until the mock payment settles. `neither` never gets one. */
  receipt: StayReceipt | null;
}

/** The billable lines for a choice, in a stable order. */
export function stayLineItems(choice: StayChoice): StayLineItem[] {
  return CHOICE_FACILITIES[choice].map((facility) => ({
    facility,
    label: FACILITY_LABEL[facility],
    amount: FACILITY_FEE[facility],
  }));
}

export function stayTotal(choice: StayChoice): number {
  return stayLineItems(choice).reduce((sum, item) => sum + item.amount, 0);
}

/** `₹2,100` for a total — the app's one currency format. */
export const money = formatRupees;

/** Whether a choice has to go through the payment step at all. */
export function needsPayment(choice: StayChoice): boolean {
  return stayLineItems(choice).length > 0;
}

/**
 * A receipt built from what `POST /hostels/pay` and/or `POST /mess/pay` actually
 * returned, rather than fabricated client-side.
 *
 * A `both` booking pays each facility with its own call, so this takes one
 * response per facility that was billed and combines them: the total is the
 * line items' sum (matching what was charged), the reference joins both
 * transaction ids so either one can be looked up, and `paid_at` is the later of
 * the two settlements — the moment the whole booking became paid in full.
 */
export function receiptFromPayments(
  choice: StayChoice,
  method: string,
  payments: Partial<Record<StayFacility, MockPaymentResponse>>,
): StayReceipt {
  const items = stayLineItems(choice);
  const references = CHOICE_FACILITIES[choice]
    .map((facility) => payments[facility]?.transaction_id)
    .filter((id): id is string => Boolean(id));
  const paidTimestamps = CHOICE_FACILITIES[choice]
    .map((facility) => payments[facility]?.paid_at)
    .filter((at): at is string => Boolean(at));

  return {
    reference: references.join(' · '),
    method,
    paid_at: paidTimestamps.sort().at(-1) ?? new Date().toISOString(),
    items,
    total: items.reduce((sum, item) => sum + item.amount, 0),
  };
}

/* ------------------------------------------------------------- storage --- */

const KEY_PREFIX = 'pc_stay_v1:';

function keyFor(participantId: string) {
  return `${KEY_PREFIX}${participantId}`;
}

/** Storage may be unavailable (private mode, tests). Fail quietly, as the auth store does. */
export function readStayRecord(participantId: string): StayRecord | null {
  try {
    const raw = localStorage.getItem(keyFor(participantId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StayRecord;
    // A hand-edited or half-written value must not crash the screen it feeds.
    if (!parsed || !STAY_CHOICES.includes(parsed.choice)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveStayRecord(participantId: string, record: StayRecord): void {
  try {
    localStorage.setItem(keyFor(participantId), JSON.stringify(record));
  } catch {
    /* ignore */
  }
}

export function clearStayRecord(participantId: string): void {
  try {
    localStorage.removeItem(keyFor(participantId));
  } catch {
    /* ignore */
  }
}
