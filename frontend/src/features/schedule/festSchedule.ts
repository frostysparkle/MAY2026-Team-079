import type { Event } from '@/api/types';

/**
 * The fest schedule as one flat, sortable, filterable list of rounds.
 *
 * Every event carries its own `schedule` array, so "the schedule" is not a thing
 * the backend returns — it is the flattening of every event's rounds into one
 * timeline. Doing that here rather than in the page keeps the view free of date
 * arithmetic, and matches how the admin lists get their rows from a feature
 * module (`hostelOccupancy`, `useHostelInventory`) rather than building them
 * inline.
 */

export interface ScheduleRow {
  /** Stable key: an event can have two rounds with the same name. */
  id: string;
  eventId: string;
  eventName: string;
  /** The backend's `event_type`, used for the category filter. */
  eventType: string;
  roundName: string;
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

/** Local calendar date as `YYYY-MM-DD`, with no timezone shift. */
function dayKeyOf(date: Date): string {
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
 * Flatten every event's rounds into one timeline, soonest first.
 *
 * Rounds with an unparseable `start_time` are dropped rather than shown at the
 * epoch: a row claiming 1 Jan 1970 is worse than no row, and the event's own page
 * still carries whatever the organiser typed.
 */
export function buildScheduleRows(events: Event[], registeredEventIds: Set<string>): ScheduleRow[] {
  const rows: ScheduleRow[] = [];

  for (const event of events) {
    (event.schedule ?? []).forEach((round, index) => {
      const start = new Date(round.start_time);
      if (Number.isNaN(start.getTime())) return;
      const end = round.end_time ? new Date(round.end_time) : null;

      rows.push({
        id: `${event.event_id}-${round.round_id ?? index}`,
        eventId: event.event_id,
        eventName: event.name,
        eventType: event.event_type,
        roundName: round.name,
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

export interface ScheduleDay {
  key: string;
  label: string;
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
    if (existing) existing.count += 1;
    else byKey.set(row.dayKey, { key: row.dayKey, label: row.dayLabel, count: 1 });
  }
  return [...byKey.values()].sort((a, b) => a.key.localeCompare(b.key));
}

/** The distinct `event_type` values present, for the category filter. */
export function scheduleCategories(rows: ScheduleRow[]): string[] {
  return [...new Set(rows.map((row) => row.eventType))].sort((a, b) => a.localeCompare(b));
}
