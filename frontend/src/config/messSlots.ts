import type { MealSlot } from '@/api/types';

/**
 * PLACEHOLDER — the backend has no mess slot-time config (MessCreateRequest
 * is just {mess_id, name, capacity, preference}). These windows must be
 * replaced with the real fest mess timings before shipping.
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
