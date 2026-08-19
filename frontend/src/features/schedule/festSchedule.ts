import type { Event } from '@/api/types';
import { categorySlugForEventType, UNLISTED_CATEGORY } from '@/features/events/eventView';
import { getPublicEventCategory } from '@/features/events/publicEvents';
import { OPEN_ENDED_ROUND_HOURS } from '@/features/overview/festMetrics';

/**
 * The fest schedule as one flat, sortable, filterable list of rounds, plus the
 * day/time grouping the timeline is drawn from.
 *
 * Every event carries its own `schedule` array, so "the schedule" is not a thing
 * the backend returns — it is the flattening of every event's rounds into one
 * timeline. Doing that here rather than in the page keeps the view free of date
 * arithmetic, and matches how the admin board gets its rows from a feature
 * module (`festMetrics`, `hostelOccupancy`) rather than building them inline.
 *
 * "Live" is defined once, in `festMetrics`, and imported: the participant's
 * schedule and the admin board's Live Now count must never disagree about
 * whether a round is running.
 */

export interface ScheduleRow {
  /** Stable key: an event can have two rounds with the same name. */
  id: string;
  eventId: string;
  eventName: string;
  /** The backend's `event_type`, used for the category filter. */
  eventType: string;
  /** How that category reads on screen, e.g. "Sports". */
  categoryLabel: string;
  /** The catalogue's colour for that category — the card's identity rail. */
  accent: string;
  roundName: string;
  /** The organiser's note on the round, when there is one. */
  description?: string;
  venue?: string;
  start: Date;
  end: Date | null;
  /** `YYYY-MM-DD` in local time — the day filter's value. */
  dayKey: string;
  /** `Thursday, 11 Jun` — what the day reads as on screen. */
  dayLabel: string;
  /** True when the viewer holds a registration for this round's event. */
  mine: boolean;
}

/* ------------------------------------------------------------ formatting --- */

/** Local calendar date as `YYYY-MM-DD`, with no timezone shift. */
export function dayKeyOf(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

export function dayLabelOf(date: Date): string {
  return date.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short' });
}

export function timeLabelOf(date: Date): string {
  return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

/**
 * A span of minutes as words: `45 min`, `1 hr 30 min`, `2 days`.
 *
 * Shared by the duration on a card and the countdown beside it, so "runs for
 * 1 hr 30 min" and "starts in 1 hr 30 min" are formatted by the same rule.
 */
export function spanLabel(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours < 24) return rest === 0 ? `${hours} hr` : `${hours} hr ${rest} min`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? '' : 's'}`;
}

/** How long a round runs, or `null` when the organiser left the end blank. */
export function durationLabel(row: ScheduleRow): string | null {
  if (!row.end) return null;
  const minutes = Math.round((row.end.getTime() - row.start.getTime()) / 60_000);
  return minutes > 0 ? spanLabel(minutes) : null;
}

/** `in 45 min` / `20 min ago` — the phrase that follows "Starts" or "Started". */
export function relativeLabel(date: Date, nowMs: number): string {
  const diff = date.getTime() - nowMs;
  const minutes = Math.round(Math.abs(diff) / 60_000);
  if (minutes < 1) return diff >= 0 ? 'any moment' : 'just now';
  return diff >= 0 ? `in ${spanLabel(minutes)}` : `${spanLabel(minutes)} ago`;
}

/* --------------------------------------------------------------- status --- */

export type RoundStatus = 'live' | 'upcoming' | 'past';

/**
 * Where one round sits against the clock.
 *
 * A round with no end time stays live for `OPEN_ENDED_ROUND_HOURS` — the same
 * window the admin board uses, and for the same reason: an organiser who left
 * the end blank has not said the round is over, but "forever" would leave a
 * round from weeks ago permanently marked live.
 */
export function roundStatus(row: ScheduleRow, nowMs: number): RoundStatus {
  const startMs = row.start.getTime();
  if (nowMs < startMs) return 'upcoming';
  const endMs = row.end?.getTime() ?? startMs + OPEN_ENDED_ROUND_HOURS * 3_600_000;
  return nowMs <= endMs ? 'live' : 'past';
}

/* ------------------------------------------------------------- category --- */

/**
 * How an `event_type` is dressed: the catalogue's label and accent colour.
 *
 * Taken from the public brochure's category table rather than invented here, so
 * a sports round is the same red in the schedule, on the events list, and on the
 * admin dashboard. Anything outside the three published categories (`others`,
 * or a value the catalogue has never heard of) falls back to the neutral grey
 * the catalogue itself uses for unlisted events, with the raw type as its label.
 */
export function categoryOf(eventType: string): { label: string; accent: string } {
  const slug = categorySlugForEventType(eventType);
  const category = slug ? getPublicEventCategory(slug) : undefined;
  if (category) return { label: category.label, accent: category.accent };
  return { label: eventType.trim() || 'Other', accent: UNLISTED_CATEGORY.accent };
}

/* ----------------------------------------------------------------- rows --- */

/**
 * Flatten every event's rounds into one timeline, soonest first.
 *
 * Rounds with an unparseable `start_time` are dropped rather than shown at the
 * epoch: a row claiming 1 Jan 1970 is worse than no row, and the event's own page
 * still carries whatever the organiser typed.
 */
export function buildScheduleRows(events: Event[], registeredEventIds: Set<string>): ScheduleRow[] {
  const rows: ScheduleRow[] = [];

  for (const event of events) {
    const category = categoryOf(event.event_type);

    (event.schedule ?? []).forEach((round, index) => {
      const start = new Date(round.start_time);
      if (Number.isNaN(start.getTime())) return;
      const end = round.end_time ? new Date(round.end_time) : null;

      rows.push({
        id: `${event.event_id}-${round.round_id ?? index}`,
        eventId: event.event_id,
        eventName: event.name,
        eventType: event.event_type,
        categoryLabel: category.label,
        accent: category.accent,
        roundName: round.name,
        description: round.description?.trim() || undefined,
        venue: round.venue?.trim() || undefined,
        start,
        end: end && !Number.isNaN(end.getTime()) ? end : null,
        dayKey: dayKeyOf(start),
        dayLabel: dayLabelOf(start),
        mine: registeredEventIds.has(event.event_id),
      });
    });
  }

  return rows.sort((a, b) => a.start.getTime() - b.start.getTime());
}

/* ----------------------------------------------------------- day / slot --- */

export interface ScheduleDay {
  key: string;
  /** `Thursday, 11 Jun`. */
  label: string;
  /** `Thu` — the day chip's top line. */
  weekday: string;
  /** `11` — the day chip's figure. */
  dayNumber: string;
  /** `Jun` — the day chip's bottom line. */
  month: string;
  count: number;
}

/**
 * Every day that actually has a round, derived from the rows.
 *
 * Derived rather than hardcoded so a date can never exist in the schedule without
 * a way to filter to it, whatever the organisers move the fest to.
 */
export function scheduleDays(rows: ScheduleRow[]): ScheduleDay[] {
  const byKey = new Map<string, ScheduleDay>();
  for (const row of rows) {
    const existing = byKey.get(row.dayKey);
    if (existing) {
      existing.count += 1;
      continue;
    }
    byKey.set(row.dayKey, {
      key: row.dayKey,
      label: row.dayLabel,
      weekday: row.start.toLocaleDateString(undefined, { weekday: 'short' }),
      dayNumber: String(row.start.getDate()),
      month: row.start.toLocaleDateString(undefined, { month: 'short' }),
      count: 1,
    });
  }
  return [...byKey.values()].sort((a, b) => a.key.localeCompare(b.key));
}

/** The distinct `event_type` values present, for the category filter. */
export function scheduleCategories(rows: ScheduleRow[]): string[] {
  return [...new Set(rows.map((row) => row.eventType))].sort((a, b) => a.localeCompare(b));
}

/** Rounds sharing one starting time, the timeline's smallest unit. */
export interface ScheduleSlot {
  key: string;
  /** `9:00 am` — what the gutter reads. */
  timeLabel: string;
  startMs: number;
  rows: ScheduleRow[];
}

/** One day of the timeline: its heading, and the slots that hang off it. */
export interface ScheduleDayGroup {
  day: ScheduleDay;
  slots: ScheduleSlot[];
}

/**
 * The timeline's shape: rows grouped by day, then by starting time.
 *
 * Rounds that start together belong on one line of the timeline — five 9:00 am
 * heats are one moment in a participant's morning, not five. Grouping them here
 * is what lets the gutter print each time exactly once, which is most of the
 * readability gain over a flat list.
 *
 * `rows` is expected in start order (`buildScheduleRows` guarantees it), so this
 * only has to walk it once.
 */
export function groupSchedule(rows: ScheduleRow[]): ScheduleDayGroup[] {
  const groups: ScheduleDayGroup[] = [];
  const byDay = new Map<string, ScheduleDayGroup>();
  const bySlot = new Map<string, ScheduleSlot>();

  for (const day of scheduleDays(rows)) {
    const group: ScheduleDayGroup = { day, slots: [] };
    byDay.set(day.key, group);
    groups.push(group);
  }

  for (const row of rows) {
    const group = byDay.get(row.dayKey);
    if (!group) continue;

    const timeLabel = timeLabelOf(row.start);
    const slotKey = `${row.dayKey}|${timeLabel}`;
    let slot = bySlot.get(slotKey);
    if (!slot) {
      slot = { key: slotKey, timeLabel, startMs: row.start.getTime(), rows: [] };
      bySlot.set(slotKey, slot);
      group.slots.push(slot);
    }
    slot.rows.push(row);
  }

  return groups;
}

/**
 * Where the "now" line belongs among a day's slots, or `null` when it does not
 * belong on this day at all.
 *
 * Returns an insertion index: `0` puts it above everything, `slots.length` below
 * everything. Only ever non-null for the day that is actually today — a marker
 * on tomorrow's column would be a lie about what is happening.
 */
export function nowMarkerIndex(
  group: ScheduleDayGroup,
  nowMs: number,
  today: string,
): number | null {
  if (group.day.key !== today) return null;
  const index = group.slots.findIndex((slot) => slot.startMs > nowMs);
  return index === -1 ? group.slots.length : index;
}
