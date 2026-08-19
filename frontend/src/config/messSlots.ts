import type { MealSlot } from '@/api/types';

/**
 * The fest mess service windows. Confirmed correct by the organisers.
 *
 * These live here because the backend has nowhere to put them: `MessCreateRequest`
 * is `{mess_id, name, capacity, preference, cuisines}`, stored mess documents carry
 * no time fields, and the `MessSlotRequest` model in `routers/mess.py` is declared
 * but wired to no route. The frontend is therefore the only source of truth for
 * slot times — verified against the API surface, not assumed.
 */
export const MESS_SLOT_WINDOWS: { slot: MealSlot; startHour: number; endHour: number }[] = [
  { slot: 'breakfast', startHour: 7, endHour: 9 },
  { slot: 'lunch', startHour: 12, endHour: 14 },
  { slot: 'dinner', startHour: 19, endHour: 21 },
];

/** Auto-detects the active meal slot from the device clock, or null outside any window. */
export function currentMessSlot(now: Date = new Date()): MealSlot | null {
  const hour = now.getHours();
  const match = MESS_SLOT_WINDOWS.find((w) => hour >= w.startHour && hour < w.endHour);
  return match?.slot ?? null;
}
