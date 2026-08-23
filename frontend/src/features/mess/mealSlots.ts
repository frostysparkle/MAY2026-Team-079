import type { MealSlot, MessSlotEntry } from '@/api/types';

/**
 * The three sittings a mess day is made of, in the order they are served.
 *
 * Both screens that read a participant's meal card used to declare this array
 * themselves — under two different names, `SLOTS` in each file — which is two
 * places for the order of the day to be got wrong.
 */
export const MEAL_SLOTS: MealSlot[] = ['breakfast', 'lunch', 'dinner'];

/** One letter each, because the grid gives a cell about 40px to say it in. */
export const MEAL_SLOT_LABEL: Record<MealSlot, string> = {
  breakfast: 'B',
  lunch: 'L',
  dinner: 'D',
};

/**
 * `GET /mess/my_mess`'s `slots` grouped back into fest days, in the shape the
 * grid and the checked-in count both read.
 *
 * The backend returns a flat list — one entry per `(day, slot)` actually on the
 * hall's menu, `day` a `"day_<n>"` string (`backend/routers/mess.py`'s
 * `my_mess`) — not a per-day `{breakfast, lunch, dinner}` object. This is the one
 * place that flat list is folded into days, so the grid and the count both read
 * the same grouping.
 */
export function groupSlotsByDay(slots: readonly MessSlotEntry[]): MessSlotEntry[][] {
  const byDay = new Map<string, MessSlotEntry[]>();
  for (const entry of slots) {
    const forDay = byDay.get(entry.day) ?? [];
    forDay.push(entry);
    byDay.set(entry.day, forDay);
  }
  // `"day_1"`, `"day_2"`, ... sorted numerically, not lexically — matching the
  // backend's own `_day_sort_key`.
  return [...byDay.entries()]
    .sort(([a], [b]) => dayNumber(a) - dayNumber(b))
    .map(([, entries]) => entries);
}

function dayNumber(dayKey: string): number {
  const match = /^day_(\d+)$/.exec(dayKey);
  return match ? Number(match[1]) : 0;
}

/**
 * How many of a participant's meal slots have been scanned, out of how many.
 *
 * Shared so the "meals checked in" figure on the Stay screen and the one on the
 * dashboard widget cannot disagree.
 */
export function loggedMeals(slots: readonly MessSlotEntry[]): { logged: number; total: number } {
  return {
    logged: slots.filter((entry) => entry.scanned).length,
    total: slots.length,
  };
}
