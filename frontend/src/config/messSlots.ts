import type { MealSlot } from '@/api/types';

/**
 * The fest mess service windows. Confirmed correct by the organisers.
 *
 * These are the fest-wide **default**, and they live here because there is no
 * fest-wide place on the server to put them: `MessCreateRequest` is
 * `{mess_id, name, capacity, preference, cuisines}` and carries no time fields.
 *
 * A *hall* now does have somewhere — `PUT /mess/{mess_id}/menu` stores a window
 * per sitting alongside the dishes — so these are the answer for a hall that has
 * published nothing, and `features/mess/messMenu.ts` layers a published menu over
 * them. `slotAt()` there is what the scanner asks which meal is open, so a hall
 * that has moved its breakfast has that move honoured by its own scanner. With
 * nothing published the two answer identically.
 *
 * (`MessSlotRequest` in `routers/mess.py` is still declared and wired to no route.
 * It is not the model the menu route uses — see `MessMenuSlot` — and is left alone
 * because removing it is not this feature's call.)
 */
export const MESS_SLOT_WINDOWS: { slot: MealSlot; startHour: number; endHour: number }[] = [
  { slot: 'breakfast', startHour: 7, endHour: 9 },
  { slot: 'lunch', startHour: 12, endHour: 14 },
  { slot: 'dinner', startHour: 19, endHour: 21 },
];
