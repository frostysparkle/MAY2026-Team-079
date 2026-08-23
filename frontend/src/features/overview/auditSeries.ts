/**
 * Turning the audit trail into series the overview board can plot.
 *
 * The trail is the only record of several things the board needs — meal swipes,
 * hostel entry and exit, accommodation requests, event registrations over time —
 * so these helpers carry real weight. All of them are pure functions over
 * `AuditLogEntry[]`, which keeps them testable without a component or a clock.
 */

import type { AuditLogEntry } from '@/api/types';

/**
 * Parse a trail timestamp.
 *
 * The backend writes `datetime.utcnow()`, which FastAPI serialises **without** a
 * timezone designator (`2026-08-18T10:23:45.123000`). ECMAScript reads a
 * date-time string with no offset as *local* time, so a naive `new Date(...)`
 * silently shifts every backend row by the viewer's UTC offset — five and a half
 * hours here, which is enough to file a swipe under the wrong day and put an
 * evening sitting in the following morning. Appending `Z` when no designator is
 * present is what makes the day boundaries in this file trustworthy.
 *
 * The mock already emits `toISOString()` with a `Z`, so it is unaffected.
 */
export function parseLogTime(timestamp: string): Date | null {
  const hasZone = /(?:Z|[+-]\d{2}:?\d{2})$/.test(timestamp);
  const date = new Date(hasZone ? timestamp : `${timestamp}Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** `YYYY-MM-DD` in the viewer's timezone — the day an admin means by "today". */
export function localDayKey(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * The instants bounding a local calendar day, as the API's `since`/`until`.
 *
 * "Today" means the viewer's day, not UTC's — an admin in IST looking at the
 * board at 02:00 means the day they are standing in. Constructing local midnight
 * and letting `toISOString()` convert gives the correct instant for that day's
 * start regardless of the offset, so the server filters on exactly the span
 * `localDayKey` would have selected client-side. Half-open, matching the server.
 */
export function localDayBounds(now: Date = new Date()): { since: string; until: string } {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return { since: start.toISOString(), until: end.toISOString() };
}

/** The instant `hours` before `now`, as the API's `since`. */
export function hoursAgoIso(hours: number, now: Date = new Date()): string {
  return new Date(now.getTime() - hours * 3_600_000).toISOString();
}

/**
 * `READ_*_ROSTER`/`READ_*_LOGS` actions — audited reads of a roster or a log,
 * not something that happened at the fest.
 *
 * The board's own medium/slow tiers are themselves the biggest source of these:
 * every 60s/120s refresh calls one statistics/participation/logs endpoint per
 * hostel block, mess hall, event and workshop, and each of those calls is
 * audited server-side (`READ_HOSTEL_ROSTER`, `READ_MESS_ROSTER`,
 * `READ_PARTICIPANT_ROSTER`, `READ_EVENT_LOGS`, `READ_WORKSHOP_LOGS`) because the
 * response carries names/contact details worth tracing back to who read them.
 * That is the right call for the audit trail itself, but it means a "what just
 * happened at the fest" feed that does not filter these out is partly measuring
 * its own polling — an admin with the Overview tab open generates dozens of
 * these an hour just by having the page on screen, which can swamp a quiet fest's
 * genuine activity and even trip the spike detector on nothing but the board's
 * own traffic.
 *
 * Excluded here, not at the source: the audit trail itself (the Audit Logs page)
 * is exactly where these rows belong and must keep recording them for
 * accountability. Only the board's *derived* "what is happening right now" views
 * — the Live activity ticker and the activity pulse/spike detector — should
 * disregard them.
 */
export function isBoardOwnReadAction(action: string): boolean {
  return action.toUpperCase().startsWith('READ_');
}

/** `logs` with the board's own audited reads (see `isBoardOwnReadAction`) removed. */
export function excludeBoardOwnReads(logs: AuditLogEntry[]): AuditLogEntry[] {
  return logs.filter((log) => !isBoardOwnReadAction(log.action));
}

/** Rows that fall on `day` (default: today) in the viewer's timezone. */
export function rowsOnDay(logs: AuditLogEntry[], day: Date = new Date()): AuditLogEntry[] {
  const key = localDayKey(day);
  return logs.filter((log) => {
    const at = parseLogTime(log.timestamp);
    return at !== null && localDayKey(at) === key;
  });
}

/** Rows in the last `minutes`. */
export function rowsSince(logs: AuditLogEntry[], minutes: number, now: Date = new Date()) {
  const cutoff = now.getTime() - minutes * 60_000;
  return logs.filter((log) => {
    const at = parseLogTime(log.timestamp);
    return at !== null && at.getTime() >= cutoff;
  });
}

export interface TimeBucket {
  label: string;
  value: number;
}

/**
 * Counts per hour over the last `hours`, oldest first.
 *
 * Empty hours are emitted as zero rather than skipped: a gap in a trend line is
 * a claim that nothing happened, and it has to be drawn to be read as one.
 */
export function bucketByHour(
  logs: AuditLogEntry[],
  hours = 24,
  now: Date = new Date(),
): TimeBucket[] {
  const counts = new Array<number>(hours).fill(0);
  const end = new Date(now);
  end.setMinutes(0, 0, 0);
  const endMs = end.getTime();

  for (const log of logs) {
    const at = parseLogTime(log.timestamp);
    if (at === null) continue;

    // Floor the row to its own clock hour before measuring the distance. Taking
    // the raw difference from `endMs` instead would file 11:05 under the 12:00
    // bucket whenever the current time is past 12:00 — a row lands in the bucket
    // for the hour it happened in, not the one it is within sixty minutes of.
    // `round` rather than `floor` so a DST shift, where the gap is not a whole
    // number of hours, still resolves to the intended bucket.
    const rowHour = new Date(at);
    rowHour.setMinutes(0, 0, 0);
    const hoursAgo = Math.round((endMs - rowHour.getTime()) / 3_600_000);

    if (hoursAgo >= 0 && hoursAgo < hours) counts[hours - 1 - hoursAgo] += 1;
  }

  return counts.map((value, index) => {
    const at = new Date(endMs - (hours - 1 - index) * 3_600_000);
    return { label: `${`${at.getHours()}`.padStart(2, '0')}:00`, value };
  });
}

/** Counts per calendar day, oldest first. Only days that appear are emitted. */
export function bucketByDay(logs: AuditLogEntry[]): TimeBucket[] {
  const counts = new Map<string, number>();
  for (const log of logs) {
    const at = parseLogTime(log.timestamp);
    if (at === null) continue;
    const key = localDayKey(at);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([label, value]) => ({ label, value }));
}

/** Distinct `actor_id` values — who has actually done something in this window. */
export function uniqueActors(logs: AuditLogEntry[]): Set<string> {
  return new Set(logs.map((log) => log.actor_id).filter(Boolean));
}

/** Distinct `details.participant_id` values, for scans recorded against a person. */
export function uniqueSubjects(logs: AuditLogEntry[]): Set<string> {
  const ids = new Set<string>();
  for (const log of logs) {
    const id = log.details?.participant_id;
    if (typeof id === 'string' && id) ids.add(id);
  }
  return ids;
}

export const MEAL_SLOTS = ['breakfast', 'lunch', 'dinner'] as const;
export type MealSlotKey = (typeof MEAL_SLOTS)[number];

export interface MealMatrix {
  /** Day keys as recorded in `details.day`, ascending — `['Day 1', 'Day 2']`. */
  days: string[];
  cells: { row: string; column: string; value: number }[];
  /** Totals per slot across every day. */
  bySlot: Record<MealSlotKey, number>;
  /**
   * Meals served: distinct `(diner, day, slot)` swipes, including the
   * `unclassified` ones. Not the number of rows.
   */
  total: number;
  /** Distinct diners across the whole window. */
  uniqueDiners: number;
  /** Rows that repeated a swipe already counted — read twice, fed once. */
  duplicateScans: number;
  /**
   * Distinct swipes with a missing or unrecognised `day`/`slot`. Counted in
   * `total`, but absent from `cells` and `bySlot` because there is no cell to
   * draw them in.
   */
  unclassified: number;
}

/**
 * Build the day × slot meal matrix from `MESS_SCAN` rows.
 *
 * `details.day` is the fest day number the scanner was set to, not a date — so
 * the matrix is keyed on the fest's own day numbering, which is what the mess
 * team actually works in.
 *
 * Two things this deliberately does *not* do any more.
 *
 * It does not count rows. `MESS_SCAN` writes one row per card read, so a card
 * read twice at a busy counter used to serve two meals as far as the board was
 * concerned. Collapsing to one entry per `(diner, day, slot)` makes `total` a
 * count of meals rather than of scanner events, and the difference is reported as
 * `duplicateScans` instead of quietly inflating the headline.
 *
 * It does not discard rows it cannot file. A swipe whose `day` or `slot` is
 * missing or unrecognised is still somebody who ate: it counts toward `total` and
 * is reported as `unclassified`. Skipping those, which is what this used to do,
 * made the headline smaller than the trail it came from with nothing on screen to
 * explain the gap.
 *
 * For a figure over a whole fest rather than a fetched page, prefer the `meals`
 * block of `GET /audit-logs/summary` — it counts the same way, server-side, with
 * no row limit in front of it.
 */
export function mealMatrix(logs: AuditLogEntry[]): MealMatrix {
  const counts = new Map<string, number>();
  const dayNumbers = new Set<number>();
  const bySlot: Record<MealSlotKey, number> = { breakfast: 0, lunch: 0, dinner: 0 };
  const diners = new Set<string>();
  // One key per distinct swipe. A row whose diner cannot be read falls back to
  // its own index, so it stays one swipe rather than collapsing every anonymous
  // row into a single one.
  const seen = new Set<string>();
  let total = 0;
  let duplicateScans = 0;
  let unclassified = 0;

  logs.forEach((log, index) => {
    const rawDay = log.details?.day;
    const rawSlot = log.details?.slot;
    const rawDiner = log.details?.participant_id;

    const diner = typeof rawDiner === 'string' && rawDiner ? rawDiner : null;
    if (diner) diners.add(diner);

    const day = typeof rawDay === 'number' ? rawDay : Number(rawDay);
    const dayOk = rawDay !== null && rawDay !== undefined && rawDay !== '' && Number.isFinite(day);
    const slot = rawSlot as MealSlotKey;
    const slotOk = typeof rawSlot === 'string' && MEAL_SLOTS.includes(slot);

    const key = `${diner ?? `#${index}`}|${dayOk ? day : '?'}|${slotOk ? slot : '?'}`;
    if (seen.has(key)) {
      duplicateScans += 1;
      return;
    }
    seen.add(key);

    // Every distinct swipe is a meal, whether or not it can be placed in the grid.
    total += 1;

    if (!dayOk || !slotOk) {
      unclassified += 1;
      return;
    }

    dayNumbers.add(day);
    const cellKey = `${day}|${slot}`;
    counts.set(cellKey, (counts.get(cellKey) ?? 0) + 1);
    bySlot[slot] += 1;
  });

  const ascending = [...dayNumbers].sort((a, b) => a - b);
  const days = ascending.map((day) => `Day ${day}`);
  const cells = ascending.flatMap((dayNumber) =>
    MEAL_SLOTS.map((slot) => ({
      row: `Day ${dayNumber}`,
      column: slot,
      value: counts.get(`${dayNumber}|${slot}`) ?? 0,
    })),
  );

  return {
    days,
    cells,
    bySlot,
    total,
    uniqueDiners: diners.size,
    duplicateScans,
    unclassified,
  };
}

/**
 * Participants whose accommodation request is still open — registered and not
 * subsequently cancelled.
 *
 * Both actions are logged with the participant as `actor_id`, so the answer is
 * "whose most recent accommodation action was a registration". Pass both action
 * feeds; order within them does not matter, since each actor's latest row wins.
 *
 * This is a *floor*: the audit `limit` truncates the trail, so a request older
 * than the window fetched is invisible here. Callers must label it as an
 * estimate — or better, prefer `hostel_pending` from `/participants/statistics`,
 * which is exact.
 */
export function openAccommodationRequests(logs: AuditLogEntry[]): Set<string> {
  const latest = new Map<string, { at: number; action: string }>();

  for (const log of logs) {
    if (log.action !== 'ACCOMMODATION_REGISTER' && log.action !== 'ACCOMMODATION_CANCEL') continue;
    const at = parseLogTime(log.timestamp);
    if (at === null) continue;
    const seen = latest.get(log.actor_id);
    if (seen === undefined || at.getTime() >= seen.at) {
      latest.set(log.actor_id, { at: at.getTime(), action: log.action });
    }
  }

  const open = new Set<string>();
  for (const [actor, entry] of latest) {
    if (entry.action === 'ACCOMMODATION_REGISTER') open.add(actor);
  }
  return open;
}

export interface ActivityPulse {
  lastHour: number;
  /** Median of the six hours before that — the baseline "normal" rate. */
  baseline: number;
  /** True when the last hour ran more than 3× the baseline. */
  spiking: boolean;
}

/** How many times the baseline the last hour must exceed to count as a spike. */
export const SPIKE_MULTIPLE = 3;

/**
 * How much activity in one hour is a spike on its own, with no baseline to
 * compare against.
 *
 * Set well above the handful of rows a quiet fest produces, and well below the
 * volume a real surge generates, because it is the only thing separating those
 * two cases when the preceding six hours are empty.
 */
export const QUIET_BASELINE_SPIKE_FLOOR = 12;

/**
 * Compare the last hour's activity against the preceding six.
 *
 * A median rather than a mean, so one busy hour in the baseline window does not
 * raise the bar enough to hide a genuine spike.
 *
 * A zero baseline used to force `spiking` false outright, on the reasoning that
 * everything is infinitely above nothing at the start of a fest. That reasoning
 * held for the first row of the fest and failed everywhere else: an empty
 * baseline is exactly what a sudden surge after a quiet spell looks like, so the
 * alert was suppressed in precisely the case it exists to catch. Worse, when this
 * ran on the newest 60 rows the busiest hour *guaranteed* an empty baseline — all
 * 60 rows landed in the current hour, the six before it read zero, and the strip
 * went quiet because the fest got loud.
 *
 * So a zero baseline now falls back to an absolute floor. One stray row on a dead
 * fest still says nothing; a hundred rows in an hour says something whether or not
 * the hours before it were empty.
 */
export function activityPulse(logs: AuditLogEntry[], now: Date = new Date()): ActivityPulse {
  const hourly = bucketByHour(logs, 7, now).map((b) => b.value);
  const lastHour = hourly[hourly.length - 1] ?? 0;
  const previous = hourly.slice(0, -1).sort((a, b) => a - b);

  const middle = Math.floor(previous.length / 2);
  const baseline =
    previous.length === 0
      ? 0
      : previous.length % 2 === 1
        ? previous[middle]
        : (previous[middle - 1] + previous[middle]) / 2;

  const spiking =
    baseline > 0 ? lastHour > baseline * SPIKE_MULTIPLE : lastHour >= QUIET_BASELINE_SPIKE_FLOOR;

  return { lastHour, baseline, spiking };
}
