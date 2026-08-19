/**
 * Reconciles the on-device selection with what the backend actually knows, and
 * reduces the pair to the handful of states the Accommodation & Mess screen has
 * to say something different about.
 *
 * The server is authoritative wherever it has an opinion. `GET /hostels/my_hostel`
 * reports both halves of the accommodation story — `registered` (asked for a
 * place) and `assigned_hostel` (got one) — and `GET /mess/my_mess` reports the
 * hall once allocation has run. A participant who was placed by the organisers
 * before ever opening this screen therefore reads as booked, with no local
 * record involved.
 *
 * Pure on purpose: every branch the screen renders is decided here, so the
 * states can be exercised without mounting anything.
 */
import type { MyHostelResponse, MyMessResponse } from '@/api/types';
import { CHOICE_FACILITIES, type StayChoice, type StayRecord } from './stayChoice';

export type FacilityState =
  /** Not part of what the student chose. */
  | 'not_selected'
  /** Chosen, but the mock payment has not settled yet. */
  | 'awaiting_payment'
  /** Paid for; the organisers' allocation batch has not placed them yet. */
  | 'awaiting_allocation'
  /** Placed — there is a block and room, or a hall, to show. */
  | 'allocated';

export interface StayStatus {
  /** Null when neither this device nor the backend records a decision. */
  choice: StayChoice | null;
  /** Whether the selection has been settled (mock receipt, or pre-existing server state). */
  paid: boolean;
  accommodation: FacilityState;
  mess: FacilityState;
  /** True while anything paid for is still waiting on the allocation batch. */
  awaitingAllocation: boolean;
}

/** What the backend alone says the student holds. */
function choiceFromServer(
  hostel: MyHostelResponse | null,
  mess: MyMessResponse | null,
): StayChoice | null {
  const hasHostel = Boolean(hostel?.registered || hostel?.assigned_hostel);
  const hasMess = Boolean(mess?.allotted_mess);
  if (hasHostel && hasMess) return 'both';
  if (hasHostel) return 'accommodation';
  if (hasMess) return 'mess';
  return null;
}

export function deriveStayStatus(
  record: StayRecord | null,
  hostel: MyHostelResponse | null,
  mess: MyMessResponse | null,
): StayStatus {
  const serverChoice = choiceFromServer(hostel, mess);
  const choice = record?.choice ?? serverChoice;

  // A pre-existing server placement counts as settled: there is no receipt to
  // find for it, and asking such a student to "pay" for a room they already
  // hold would be worse than wrong.
  const paid = record ? record.receipt !== null : serverChoice !== null;

  const selected = choice ? CHOICE_FACILITIES[choice] : [];

  const facilityState = (wanted: boolean, allocated: boolean): FacilityState => {
    if (allocated) return 'allocated';
    if (!wanted) return 'not_selected';
    return paid ? 'awaiting_allocation' : 'awaiting_payment';
  };

  const accommodation = facilityState(
    selected.includes('accommodation'),
    Boolean(hostel?.assigned_hostel),
  );
  const messState = facilityState(selected.includes('mess'), Boolean(mess?.allotted_mess));

  return {
    choice,
    paid,
    accommodation,
    mess: messState,
    awaitingAllocation:
      accommodation === 'awaiting_allocation' || messState === 'awaiting_allocation',
  };
}
