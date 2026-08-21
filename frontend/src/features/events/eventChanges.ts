import type { Event, MyEventRegistration, ScheduleRound } from '@/api/types';

/**
 * Venue and time change alerts for the events a participant is registered for —
 * Story 1.2.
 *
 * ## Why this is detected on the device
 *
 * The backend has no notification domain: no announcement collection, no
 * subscription store, no delivery route, and `GET /audit-logs` — where
 * `UPDATE_EVENT` is recorded — is Super Admin only. There is nothing a
 * participant's client can subscribe to and nothing that can be pushed at it.
 *
 * What a participant *can* read is `GET /events`, which returns every event's
 * full `schedule` array (round name, venue, start and end), and
 * `GET /events/my_registrations`, which says which of them are theirs. That is
 * enough to answer the story's question — "has the venue or time of something I
 * am registered for changed?" — by remembering what this device last saw and
 * comparing.
 *
 * So each load takes a snapshot of the rounds of the participant's registered
 * events, diffs it against the snapshot stored from last time, and turns any
 * difference into an alert that persists until it is dismissed.
 *
 * ## What this is not
 *
 * It is **not** push. An alert surfaces the next time the participant opens the
 * app, not the moment an organiser saves the edit, and a change made before this
 * device ever saw the event establishes the baseline rather than raising an
 * alert. Genuine push needs a subscription store and a send route, which is
 * backend work; see the audit's "What is actually left".
 *
 * Everything here is defensive: storage may be unavailable or hand-edited, and a
 * malformed record must degrade to "no history yet", never throw.
 */

/** Which fact about a round moved. */
export type EventChangeField = 'venue' | 'start' | 'end';

export const CHANGE_FIELD_LABEL: Record<EventChangeField, string> = {
  venue: 'Venue',
  start: 'Start time',
  end: 'End time',
};

export interface EventChange {
  /** Stable across reloads, so a dismissed alert stays dismissed. */
  id: string;
  eventId: string;
  eventName: string;
  roundName: string;
  field: EventChangeField;
  /** Empty when the field had no value before — "set", rather than "changed". */
  from: string;
  to: string;
  /** When this device noticed, ISO. Not when the organiser made the edit. */
  noticedAt: string;
}

interface RoundSnapshot {
  id: string;
  name: string;
  venue: string;
  start: string;
  end: string;
}

interface EventSnapshot {
  name: string;
  rounds: RoundSnapshot[];
}

/** What one participant's device remembers. */
export interface EventWatch {
  /** Schema version, so a future shape change discards cleanly instead of misreading. */
  v: 1;
  /** event_id → the rounds as this device last saw them. */
  seen: Record<string, EventSnapshot>;
  /** Noticed but not yet dismissed, newest first. */
  pending: EventChange[];
}

export const EMPTY_WATCH: EventWatch = { v: 1, seen: {}, pending: [] };

/**
 * Alerts kept per participant. Enough to cover a fest's worth of edits without
 * letting a pathological rename loop grow the record without bound.
 */
const MAX_PENDING = 50;

/* ------------------------------------------------------------ snapshots --- */

/**
 * A round's identity across two reads.
 *
 * `round_id` is assigned by `POST /events` and is the honest key when present.
 * It is optional on the type and absent on hand-seeded catalogue data, so the
 * fallback is the position — which is already how this codebase aligns a round
 * with its display overrides (`round_when` in `eventExtras`).
 */
function roundKey(round: ScheduleRound, index: number): string {
  return round.round_id?.trim() || `#${index}`;
}

function snapshotEvent(event: Event): EventSnapshot {
  return {
    name: event.name,
    rounds: (event.schedule ?? []).map((round, index) => ({
      id: roundKey(round, index),
      name: round.name?.trim() || `Round ${index + 1}`,
      venue: round.venue?.trim() ?? '',
      start: round.start_time?.trim() ?? '',
      end: round.end_time?.trim() ?? '',
    })),
  };
}

/**
 * Every venue or time difference between two readings of one event.
 *
 * Rounds are matched by `roundKey`. A round that appears or disappears yields no
 * alert: the story is about a venue or time *changing*, and an organiser adding a
 * round is a different event from moving one. The new shape is still recorded, so
 * the next edit to it is caught normally.
 */
function diffEvent(
  eventId: string,
  eventName: string,
  previous: EventSnapshot,
  current: EventSnapshot,
  noticedAt: string,
): EventChange[] {
  const before = new Map(previous.rounds.map((round) => [round.id, round]));
  const changes: EventChange[] = [];

  for (const round of current.rounds) {
    const was = before.get(round.id);
    if (!was) continue;

    const fields: [EventChangeField, string, string][] = [
      ['venue', was.venue, round.venue],
      ['start', was.start, round.start],
      ['end', was.end, round.end],
    ];

    for (const [field, from, to] of fields) {
      if (from === to) continue;
      // A field going blank is an organiser clearing it, which tells a
      // participant nothing actionable about where to be. Only report a value
      // that has actually been set to something.
      if (!to) continue;
      changes.push({
        id: `${eventId}|${round.id}|${field}|${to}`,
        eventId,
        eventName,
        roundName: round.name,
        field,
        from,
        to,
        noticedAt,
      });
    }
  }

  return changes;
}

/* ---------------------------------------------------------- reconciling --- */

/**
 * Fold this reading of the participant's registered events into what the device
 * already knew.
 *
 * Pure, so the whole rule set is testable without storage or a clock. The caller
 * supplies `noticedAt`.
 */
export function reconcile(
  previous: EventWatch | null,
  registeredEvents: Event[],
  noticedAt: string,
): { record: EventWatch; fresh: EventChange[] } {
  const known = previous ?? EMPTY_WATCH;
  const seen: Record<string, EventSnapshot> = {};
  const fresh: EventChange[] = [];

  for (const event of registeredEvents) {
    const current = snapshotEvent(event);
    const before = known.seen[event.event_id];
    // No history for this event yet — registering for it establishes the
    // baseline. Alerting here would fire on every first sight of every event.
    if (before) fresh.push(...diffEvent(event.event_id, event.name, before, current, noticedAt));
    seen[event.event_id] = current;
  }

  // A cancelled registration takes its outstanding alerts with it: the
  // participant is no longer going, so where it moved to is no longer news.
  const stillRegistered = new Set(registeredEvents.map((e) => e.event_id));
  const kept = known.pending.filter((change) => stillRegistered.has(change.eventId));

  // Dedupe on id so a change that has already been recorded is not appended
  // again on every reload until it is dismissed.
  const alreadyKnown = new Set(kept.map((change) => change.id));
  const added = fresh.filter((change) => !alreadyKnown.has(change.id));

  return {
    record: { v: 1, seen, pending: [...added, ...kept].slice(0, MAX_PENDING) },
    fresh: added,
  };
}

/** Drop one alert by id. */
export function withoutChange(record: EventWatch, changeId: string): EventWatch {
  return { ...record, pending: record.pending.filter((change) => change.id !== changeId) };
}

/* ------------------------------------------------------------- storage --- */

const KEY_PREFIX = 'pc_event_watch_v1:';

function keyFor(participantId: string) {
  return `${KEY_PREFIX}${participantId}`;
}

/** Storage may be unavailable (private mode, tests). Fail quietly, as the auth store does. */
export function readEventWatch(participantId: string): EventWatch | null {
  try {
    const raw = localStorage.getItem(keyFor(participantId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as EventWatch;
    // A hand-edited or half-written value must not crash the screen it feeds,
    // and a record from a future schema must not be read as if it were this one.
    if (!parsed || parsed.v !== 1 || typeof parsed.seen !== 'object' || !parsed.seen) return null;
    if (!Array.isArray(parsed.pending)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveEventWatch(participantId: string, record: EventWatch): void {
  try {
    localStorage.setItem(keyFor(participantId), JSON.stringify(record));
  } catch {
    /* ignore */
  }
}

export function clearEventWatch(participantId: string): void {
  try {
    localStorage.removeItem(keyFor(participantId));
  } catch {
    /* ignore */
  }
}

/* --------------------------------------------------------- entry points --- */

/** The events this participant holds a registration for. */
export function registeredEvents(events: Event[], registrations: MyEventRegistration[]): Event[] {
  const mine = new Set(registrations.map((r) => r.event_id));
  return events.filter((event) => mine.has(event.event_id));
}

/**
 * Compare this load against what the device remembered, persist the new reading,
 * and hand back every alert still outstanding.
 *
 * Called from a page's load callback rather than from an effect of its own, so
 * it runs on exactly the data the page just fetched and adds no second request.
 * Idempotent: running it twice on the same data records the change once.
 */
export function syncEventChanges(
  participantId: string,
  events: Event[],
  registrations: MyEventRegistration[],
  now: Date = new Date(),
): EventChange[] {
  if (!participantId) return [];
  const { record } = reconcile(
    readEventWatch(participantId),
    registeredEvents(events, registrations),
    now.toISOString(),
  );
  saveEventWatch(participantId, record);
  return record.pending;
}

/** Dismiss one alert and hand back what is left. */
export function dismissEventChange(participantId: string, changeId: string): EventChange[] {
  const record = readEventWatch(participantId);
  if (!record) return [];
  const next = withoutChange(record, changeId);
  saveEventWatch(participantId, next);
  return next.pending;
}

/** Dismiss everything outstanding. */
export function dismissAllEventChanges(participantId: string): EventChange[] {
  const record = readEventWatch(participantId);
  if (!record) return [];
  saveEventWatch(participantId, { ...record, pending: [] });
  return [];
}
