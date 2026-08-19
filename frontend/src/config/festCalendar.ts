/**
 * PLACEHOLDER — the backend has no fest-calendar config; day boundaries for
 * mess scanning (1-5) must be computed client-side. Replace FEST_START_DATE
 * with the real fest start date before shipping.
 */
export const FEST_START_DATE = new Date();
FEST_START_DATE.setHours(0, 0, 0, 0);

export const FEST_DAYS = 5;

/** Current fest day (1-5), clamped to the valid range. */
export function currentFestDay(now: Date = new Date()): number {
  const diffMs = now.getTime() - FEST_START_DATE.getTime();
  const day = Math.floor(diffMs / (24 * 60 * 60 * 1000)) + 1;
  return Math.min(Math.max(day, 1), FEST_DAYS);
}
