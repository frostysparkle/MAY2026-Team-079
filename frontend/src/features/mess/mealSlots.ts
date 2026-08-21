import type { MessDayEntry } from '@/api/types';

/**
 * The three sittings a mess day is made of, in the order they are served.
 *
 * Both screens that read a participant's meal card used to declare this array
 * themselves — under two different names, `SLOTS` in each file — which is two
 * places for the order of the day to be got wrong.
 */
export const MEAL_SLOTS: (keyof MessDayEntry)[] = ['breakfast', 'lunch', 'dinner'];

/** One letter each, because the grid gives a cell about 40px to say it in. */
export const MEAL_SLOT_LABEL: Record<keyof MessDayEntry, string> = {
  breakfast: 'B',
  lunch: 'L',
  dinner: 'D',
};

/**
 * How many of a participant's meal slots have been scanned, out of how many.
 *
 * Shared so the "meals checked in" figure on the Stay screen and the one on the
 * dashboard widget cannot disagree: both used to reduce over the days themselves,
 * and the two reductions differed in whether they guarded the slot lookup —
 * `day[slot].logged` against `day[slot]?.logged` — so one of them would throw on
 * a day the backend returned short.
 */
export function loggedMeals(slots: readonly MessDayEntry[]): { logged: number; total: number } {
  return {
    logged: slots.reduce(
      (sum, day) => sum + MEAL_SLOTS.filter((slot) => day[slot]?.logged).length,
      0,
    ),
    total: slots.length * MEAL_SLOTS.length,
  };
}
