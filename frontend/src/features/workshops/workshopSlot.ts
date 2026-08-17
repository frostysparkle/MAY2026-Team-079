/**
 * A workshop's day and shift, carried in the backend's `slot_id`.
 *
 * This is not a workaround for a missing column — `slot_id` *is* the time-slot
 * identifier, and `POST /workshops/{id}/register` already refuses a second
 * booking in the same slot by comparing it ("Already registered for another
 * workshop in this time slot"). Encoding the day and shift into it is what
 * makes that rule mean the right thing: two workshops that genuinely clash
 * share a slot id, and the backend enforces the one-per-shift rule for free.
 *
 * Format: `YYYY-MM-DD-morning` / `YYYY-MM-DD-afternoon`.
 *
 * Anything that does not match is left alone rather than rejected — an admin
 * may have typed a slot id by hand, and a workshop with an unparseable slot
 * still belongs on the programme; it simply carries no day or shift filter.
 */

export type WorkshopShift = 'morning' | 'afternoon';

export const WORKSHOP_SHIFTS: WorkshopShift[] = ['morning', 'afternoon'];

export interface WorkshopSlot {
  /** ISO `YYYY-MM-DD`, or undefined when the slot id is free-form. */
  date?: string;
  shift?: WorkshopShift;
}

const SLOT_PATTERN = /^(\d{4}-\d{2}-\d{2})-(morning|afternoon)$/;

/** `2026-06-11-morning` → `{ date: '2026-06-11', shift: 'morning' }`. */
export function parseSlotId(slotId: string | undefined): WorkshopSlot {
  const match = SLOT_PATTERN.exec((slotId ?? '').trim());
  if (!match) return {};
  return { date: match[1], shift: match[2] as WorkshopShift };
}

/** `{ date, shift }` → `2026-06-11-morning`. Empty when the day is missing. */
export function formatSlotId(date: string, shift: WorkshopShift): string {
  const day = date.trim();
  return day ? `${day}-${shift}` : '';
}

/** `2026-06-11` → `11 June`. Returns the input when it is not a plain date. */
export function workshopDayLabel(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return iso;
  const [, year, month, day] = match;
  // Constructed from parts rather than parsed, so there is no timezone shift.
  const monthName = new Date(Number(year), Number(month) - 1, 1).toLocaleDateString('en-IN', {
    month: 'long',
  });
  return `${Number(day)} ${monthName}`;
}

export function shiftLabel(shift: WorkshopShift): string {
  return shift === 'morning' ? 'Morning' : 'Afternoon';
}
