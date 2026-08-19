import { FESTIVAL_DAYS } from '@/features/events/publicSchedule';

/**
 * Fest day boundaries for mess scanning.
 *
 * The backend has no fest-calendar config, so day 1..N has to be computed on the
 * client. It is derived from the published schedule rather than hardcoded: this
 * used to be `new Date()`, which meant "the fest starts today" on every single
 * run, so `currentFestDay()` always returned 1 no matter when it was called.
 *
 * `publicSchedule` carries the real dates (mirrored from iitmparadox.org), and
 * `FESTIVAL_DAYS` is its sorted ISO list, so the start moves with the schedule
 * instead of drifting with the clock.
 */
export const FEST_START_DATE = FESTIVAL_DAYS.length
  ? new Date(`${FESTIVAL_DAYS[0]}T00:00:00`)
  : /* No schedule published yet — fall back to today so scanning still works. */
    new Date(new Date().setHours(0, 0, 0, 0));

/**
 * Mess service days, deliberately **not** `FESTIVAL_DAYS.length`.
 *
 * The published schedule runs six days, but a participant's `mess.entries` is
 * seeded by the backend with days 1-5 only. Reporting a day 6 scan would target
 * an entry that does not exist, so this tracks the backend's data model rather
 * than the brochure.
 */
export const FEST_DAYS = 5;

/** Current fest day (1-5), clamped to the valid range. */
export function currentFestDay(now: Date = new Date()): number {
  const diffMs = now.getTime() - FEST_START_DATE.getTime();
  const day = Math.floor(diffMs / (24 * 60 * 60 * 1000)) + 1;
  return Math.min(Math.max(day, 1), FEST_DAYS);
}
