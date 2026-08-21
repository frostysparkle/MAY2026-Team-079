import type { AuditLogEntry, EventLogRow, WorkshopLogRow } from '@/api/types';
import type { BadgeTone } from '@/components/ui';

/**
 * One timeline shape for four different kinds of record.
 *
 * An admin asking "what happened at this mess hall?" should not have to know that
 * meal scans live in the audit trail while workshop attendance lives in its own
 * collection and event attendance in a third. The system records activity in
 * three different places, with three different field names for the same idea:
 *
 *   - the audit trail (`system_logs`) — every privileged action, plus the *only*
 *     record of mess meal scans and hostel entry/exit
 *   - `event_logs`   — one row per event attendance scan
 *   - `workshop_logs` — bookings and attendance scans, with a `scan_type`
 *
 * This module normalises all three into `LogEntry` so a single list can show
 * them in one order. Nothing is dropped in the process: details this code does
 * not recognise are still surfaced verbatim, because an audit view that quietly
 * hides a recorded field is worse than no audit view.
 */

/** What kind of thing happened. Drives the icon, the tone, and the filters. */
export type LogKind =
  | 'entry'
  | 'exit'
  | 'meal'
  | 'attendance'
  | 'registration'
  | 'team'
  | 'lifecycle'
  | 'allocation'
  | 'other';

export const LOG_KIND_LABEL: Record<LogKind, string> = {
  entry: 'Entry',
  exit: 'Exit',
  meal: 'Meal',
  attendance: 'Attendance',
  registration: 'Registration',
  team: 'Team',
  lifecycle: 'Record',
  allocation: 'Allocation',
  other: 'Other',
};

export const LOG_KIND_TONE: Record<LogKind, BadgeTone> = {
  entry: 'success',
  exit: 'warning',
  meal: 'info',
  attendance: 'success',
  registration: 'info',
  team: 'neutral',
  lifecycle: 'neutral',
  allocation: 'warning',
  other: 'neutral',
};

/** A single fact recorded alongside an entry, ready to render. */
export interface LogFact {
  label: string;
  value: string;
}

export interface LogEntry {
  /** Stable React key. Log rows carry no id, so it is composed from the content. */
  key: string;
  /** ISO timestamp. */
  timestamp: string;
  /** The action exactly as recorded, e.g. `HOSTEL_ENTRY`. */
  action: string;
  /** Human-readable summary, e.g. "Entered the block". */
  label: string;
  /**
   * The whole record as one line, e.g. "Priya Raman assigned Arjun Kumar as
   * volunteer to Mess hall 2".
   *
   * A row used to be a label over a run of labelled ids, which left the reader to
   * work out that two similar-looking ids were two different people in two
   * different roles. Naming them in order removes that work. Ids that resolved to
   * no name appear here as ids, so the line is never less informative than the
   * fields it replaced.
   */
  sentence: string;
  kind: LogKind;
  /** Which section this belongs to, when known. */
  domain: LogDomain | null;
  /** The entity this concerns — an event_id, workshop_id, mess_id, hostel_id. */
  targetId: string | null;
  /** The entity's name, when the caller supplied a directory to look it up in. */
  targetName: string | null;
  /** Who performed it. */
  actorId: string | null;
  /** The actor's name, or null when the id resolved to nobody. */
  actorName: string | null;
  /**
   * True when there is an actor id but no name to be found for it anywhere.
   *
   * Worth surfacing rather than leaving as a bare code: it means the account was
   * removed after the action, which is a fact about the record, not a failure of
   * the view. Without saying so, a row like `TEMPSEED0001 created Last1Standing`
   * reads as though the screen is broken.
   */
  actorMissing: boolean;
  /** The actor's role at the time, e.g. `super_admin`. */
  actorRole: string | null;
  /** Who it was performed on, when the record names someone. */
  participantId: string | null;
  participantName: string | null;
  facts: LogFact[];
  /** Where the record came from, shown so a reader can go check the source. */
  source: 'audit' | 'event_logs' | 'workshop_logs';
}

/**
 * Entity ids to their names, for turning a `target_id` into something readable.
 *
 * Passed in rather than fetched here: the pages that show logs already hold the
 * event, workshop, hall, and block lists for their own filters, so this reuses
 * what is in hand instead of adding a request. Optional throughout — without it
 * a target falls back to its id, exactly as before.
 */
export type EntityNames = Readonly<Record<string, string>>;

/* ------------------------------------------------------------- domains --- */

export type LogDomain = 'events' | 'workshops' | 'mess' | 'hostels';

export const LOG_DOMAINS: LogDomain[] = ['events', 'workshops', 'mess', 'hostels'];

export const LOG_DOMAIN_LABEL: Record<LogDomain, { plural: string; singular: string }> = {
  events: { plural: 'Events', singular: 'Event' },
  workshops: { plural: 'Workshops', singular: 'Workshop' },
  mess: { plural: 'Mess halls', singular: 'Mess hall' },
  hostels: { plural: 'Hostels', singular: 'Hostel block' },
};

/**
 * Which section an action belongs to, read from the action name.
 *
 * The audit trail records no domain of its own, so this is inferred. Order
 * matters: `ALLOCATE_EVENT_TEAMS` mentions both a team and an event, and
 * `ASSIGN_MESS_TEAM` mentions a team and a hall, so the domain word is what is
 * matched rather than the verb.
 */
export function domainOfAction(action: string): LogDomain | null {
  const upper = action.toUpperCase();
  if (upper.includes('HOSTEL')) return 'hostels';
  if (upper.includes('MESS')) return 'mess';
  if (upper.includes('WORKSHOP')) return 'workshops';
  if (upper.includes('EVENT')) return 'events';
  return null;
}

/* ----------------------------------------------------------- classifier --- */

/** How an audit action reads to a person, and what kind of thing it is. */
function describeAuditAction(action: string): { kind: LogKind; label: string } {
  const upper = action.toUpperCase();

  // The two records that exist nowhere else in the system.
  if (upper === 'HOSTEL_ENTRY') return { kind: 'entry', label: 'Entered the block' };
  if (upper === 'HOSTEL_EXIT') return { kind: 'exit', label: 'Left the block' };
  if (upper === 'MESS_SCAN') return { kind: 'meal', label: 'Meal served' };

  if (upper === 'EVENT_REGISTER') return { kind: 'registration', label: 'Registered' };
  if (upper === 'EVENT_DEREGISTER') {
    return { kind: 'registration', label: 'Cancelled registration' };
  }

  if (upper.startsWith('ASSIGN_')) return { kind: 'team', label: 'Team member assigned' };
  if (upper.startsWith('ALLOCATE_')) return { kind: 'allocation', label: 'Allocation run' };
  if (upper.startsWith('CREATE_')) return { kind: 'lifecycle', label: 'Created' };
  if (upper.startsWith('UPDATE_')) return { kind: 'lifecycle', label: 'Updated' };
  if (upper.startsWith('DELETE_')) return { kind: 'lifecycle', label: 'Deleted' };

  // An action this build has never seen still belongs in the trail, under its own
  // name, rather than being swallowed.
  return { kind: 'other', label: action };
}

/** Meal slots read as words; anything else is shown as stored. */
function mealLabel(slot: unknown): string {
  const value = String(slot ?? '');
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : '—';
}

/** Prettify a details key: `fields_updated` → "Fields updated". */
function factLabel(key: string): string {
  const words = key.replace(/_/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Render any recorded value as a single readable string. */
function factValue(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (Array.isArray(value)) return value.length === 0 ? '—' : value.join(', ');
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/**
 * Keys inside `details` that hold a person's id rather than a value.
 *
 * Each one gets the person's name as its value and a label that says which
 * person, because "Member Arjun Kumar" is a fact and "Team user id B413179v1" is
 * a puzzle. The backend resolves all four into the entry's `names` map.
 */
const PERSON_DETAIL_LABEL: Record<string, string> = {
  team_user_id: 'Member',
  assigned_user: 'Member',
  user_id: 'Member',
};

/** A person id as a reader should see it: their name when known, the id when not. */
function personLabel(
  id: unknown,
  names: Readonly<Record<string, string>> | undefined,
): string | null {
  if (typeof id !== 'string' || id === '') return null;
  return names?.[id] ?? id;
}

/**
 * The name for an id, or null when nothing resolved it.
 *
 * The counterpart to `personLabel`: that one is for display and falls back to the
 * id, this one is for the `actorName`/`participantName` fields, where null has to
 * mean "no name known" so a row can tell the difference.
 */
function resolvedName(
  id: string | null | undefined,
  names: Readonly<Record<string, string>> | undefined,
): string | null {
  return id ? (names?.[id] ?? null) : null;
}

/**
 * Turn a details object into facts.
 *
 * `participant_id` is pulled out by the caller and shown as its own field, so it
 * is skipped here. Everything else is rendered — recognised keys get a nicer
 * label, unrecognised keys are shown under their own name so nothing recorded is
 * invisible.
 *
 * `names` resolves the keys that hold a person id. A key whose id resolved to no
 * name still shows the id, so this never removes information from a row.
 */
function factsFromDetails(
  details: Record<string, unknown> | undefined,
  names?: Readonly<Record<string, string>>,
): LogFact[] {
  if (!details) return [];

  const facts: LogFact[] = [];
  for (const [key, value] of Object.entries(details)) {
    if (key === 'participant_id') continue;
    if (key in PERSON_DETAIL_LABEL) {
      const person = personLabel(value, names);
      if (person) facts.push({ label: PERSON_DETAIL_LABEL[key], value: person });
      continue;
    }
    if (key === 'slot') {
      facts.push({ label: 'Meal', value: mealLabel(value) });
      continue;
    }
    if (key === 'day') {
      // Mess days are numbered from the start of the fest; event logs use a date.
      const asNumber = Number(value);
      facts.push({
        label: 'Day',
        value:
          Number.isFinite(asNumber) && String(value).length <= 2 ? `Day ${value}` : String(value),
      });
      continue;
    }
    facts.push({ label: factLabel(key), value: factValue(value) });
  }
  return facts;
}

/* ------------------------------------------------------------ sentences --- */

/**
 * One audit entry as a sentence.
 *
 * Ordered the way the action happened — who acted, what they did, to whom, where —
 * because the fields alone do not say which of two similar ids is the person
 * acting and which is the person acted upon. That was the specific thing making
 * team assignments and scans hard to read.
 *
 * Every branch degrades rather than fails: an unknown action falls through to the
 * generic phrasing, and any name that could not be resolved appears as its id.
 */
function auditSentence(
  log: AuditLogEntry,
  parts: {
    actor: string | null;
    target: string | null;
    subject: string | null;
    people: Readonly<Record<string, string>>;
  },
): string {
  const details = log.details ?? {};
  const upper = log.action.toUpperCase();

  const actor = parts.actor ?? 'Someone';
  const subject = parts.subject;
  const at = parts.target ? ` at ${parts.target}` : '';
  const to = parts.target ? ` to ${parts.target}` : '';
  const forTarget = parts.target ? ` for ${parts.target}` : '';
  const named = parts.target ? ` ${parts.target}` : '';

  const member = personLabel(
    details.team_user_id ?? details.assigned_user ?? details.user_id,
    parts.people,
  );
  const role = typeof details.role === 'string' && details.role ? details.role : null;

  // Scans and entry/exit read from the participant's side: they are the event, and
  // the staff member holding the scanner is the supporting detail.
  if (upper === 'HOSTEL_ENTRY' || upper === 'HOSTEL_EXIT') {
    const verb = upper === 'HOSTEL_ENTRY' ? 'entered' : 'left';
    const who = subject ?? 'A participant';
    return `${who} ${verb}${named ? named : ' the block'}, recorded by ${actor}`;
  }
  if (upper === 'MESS_SCAN') {
    const meal = typeof details.slot === 'string' ? details.slot : null;
    const who = subject ?? 'A participant';
    return `${who} was served ${meal ?? 'a meal'}${at}, recorded by ${actor}`;
  }

  if (upper === 'EVENT_REGISTER') return `${actor} registered${forTarget}`;
  if (upper === 'EVENT_DEREGISTER') return `${actor} cancelled their registration${forTarget}`;
  if (upper === 'ACCOMMODATION_REGISTER') return `${actor} requested accommodation`;
  if (upper === 'ACCOMMODATION_CANCEL') return `${actor} withdrew their accommodation request`;

  if (upper.startsWith('ASSIGN_')) {
    const as = role ? ` as ${role}` : '';
    return `${actor} assigned ${member ?? 'a team member'}${as}${to}`;
  }
  if (upper === 'REMOVE_WORKSHOP_VOLUNTEER') {
    return `${actor} removed ${member ?? 'a volunteer'}${parts.target ? ` from ${parts.target}` : ''}`;
  }
  if (upper.startsWith('ALLOCATE_')) {
    const count = details.allocated_count ?? details.teams_created;
    const howMany = typeof count === 'number' ? ` ${count}` : '';
    const what = upper.includes('TEAM') ? 'team' : 'place';
    const plural = howMany === ' 1' ? what : `${what}s`;
    return `${actor} ran an allocation${forTarget}, filling${howMany} ${plural}`;
  }

  if (upper === 'UPDATE_WORKSHOP_PARTICIPANT') {
    return `${actor} corrected ${subject ? `${subject}'s` : 'a participant'} record${forTarget}`;
  }
  if (upper === 'UPDATE_PARTICIPANT') {
    // Here the target is the participant, not a venue.
    return `${actor} updated ${parts.target ?? 'a participant'}'s profile`;
  }

  if (upper === 'RAISE_QUERY') return `${actor} raised a query`;
  if (upper === 'REPLY_QUERY') return `${actor} replied to a query`;
  if (upper === 'UPDATE_QUERY') return `${actor} updated a query`;
  if (upper === 'ISSUE_REPORT') return `${actor} reported an issue${at}`;
  if (upper === 'ISSUE_UPDATE') return `${actor} updated a reported issue${at}`;

  if (upper.startsWith('CREATE_')) return `${actor} created${named || ' a record'}`;
  if (upper.startsWith('UPDATE_')) return `${actor} updated${named || ' a record'}`;
  if (upper.startsWith('DELETE_')) return `${actor} deleted${named || ' a record'}`;

  // An action this build has never seen still reads as a sentence rather than as
  // a bare constant, with the action name carrying the meaning.
  return `${actor} performed ${log.action}${named}`;
}

/* ------------------------------------------------------------ adapters --- */

/**
 * Every name a log row might need, from whatever the calling page already holds.
 *
 * Kept as two maps rather than one because the two kinds of id are looked up in
 * different places and a page often has one without the other: the audit trail
 * arrives with people's names attached, while entity names come from the
 * event/workshop/hall/block lists a page fetched for its own filters.
 */
export interface LogNames {
  /** Entity ids — `event_id`, `workshop_id`, `mess_id`, `hostel_id` — to names. */
  entities?: EntityNames;
  /** Person ids — staff `paradox_id` or `participant_id` — to names. */
  people?: Readonly<Record<string, string>>;
}

/**
 * Collect the names the audit trail already carries, for rows from other sources.
 *
 * The scan collections behind event and workshop attendance store only ids. The
 * same people almost always appear in the audit trail for the same entity, which
 * arrives with names resolved, so pooling them names the scan rows too without a
 * further request.
 */
export function peopleNamesFrom(logs: AuditLogEntry[]): Record<string, string> {
  const people: Record<string, string> = {};
  for (const log of logs) {
    if (log.actor_name && log.actor_id) people[log.actor_id] = log.actor_name;
    Object.assign(people, log.names ?? {});
  }
  return people;
}

/**
 * Audit trail entries — the broadest source, and the only one for mess/hostels.
 *
 * `names` is optional: with it a target reads as "Mess hall 2", without it as
 * `MESS_PROBE2_413179`. A target that is a person rather than a venue — as
 * `UPDATE_PARTICIPANT`'s is — falls back to the entry's own `names` map.
 */
export function fromAuditLogs(logs: AuditLogEntry[], names?: LogNames): LogEntry[] {
  return logs.map((log, i) => {
    const { kind, label } = describeAuditAction(log.action);
    const participantId =
      typeof log.details?.participant_id === 'string' ? log.details.participant_id : null;

    // The entry's own map first — it is the names as the server resolved them for
    // this row — then anything extra the page knows.
    const people = { ...names?.people, ...log.names };

    const targetId = log.target_id ?? null;
    const targetName = targetId ? (names?.entities?.[targetId] ?? people[targetId] ?? null) : null;
    const actorName = log.actor_name ?? resolvedName(log.actor_id, people);
    const participantName = resolvedName(participantId, people);

    return {
      key: `audit-${log.timestamp}-${log.action}-${log.target_id ?? ''}-${i}`,
      timestamp: log.timestamp,
      action: log.action,
      label,
      sentence: auditSentence(log, {
        // Display labels here, so an id that resolved to no name still reads in
        // the sentence rather than leaving a gap.
        actor: actorName ?? log.actor_id ?? null,
        target: targetName ?? targetId,
        subject: personLabel(participantId, people),
        people,
      }),
      kind,
      domain: domainOfAction(log.action),
      targetId,
      targetName,
      actorId: log.actor_id,
      actorName,
      actorMissing: Boolean(log.actor_id) && actorName === null,
      actorRole: log.actor_role ?? null,
      participantId,
      participantName,
      facts: factsFromDetails(log.details, people),
      source: 'audit',
    };
  });
}

/**
 * Event attendance scans — `GET /events/{id}/logs`.
 *
 * These rows key the event on its ObjectId rather than its readable `event_id`,
 * so `names.entities` has to be keyed on whatever `row.event_id` holds. The
 * caller that has both does that registration; see `useEntityLogs`.
 */
export function fromEventLogs(rows: EventLogRow[], names?: LogNames): LogEntry[] {
  return rows.map((row, i) => {
    const who = personLabel(row.participant_id, names?.people) ?? 'A participant';
    const by = personLabel(row.scanned_by, names?.people);
    const targetName = names?.entities?.[row.event_id] ?? null;
    const where = targetName ? ` at ${targetName}` : '';

    return {
      key: `event-${row.event_id}-${row.participant_id}-${row.day}-${i}`,
      timestamp: row.timestamp,
      action: 'EVENT_ATTENDANCE',
      label: 'Attendance scanned',
      sentence: `${who} was marked present${where}${by ? `, scanned by ${by}` : ''}`,
      kind: 'attendance',
      domain: 'events',
      targetId: row.event_id,
      targetName,
      actorId: row.scanned_by,
      actorName: resolvedName(row.scanned_by, names?.people),
      actorMissing: Boolean(row.scanned_by) && !resolvedName(row.scanned_by, names?.people),
      actorRole: null,
      participantId: row.participant_id,
      participantName: resolvedName(row.participant_id, names?.people),
      // The day is the field the scan endpoint dedupes on, so it explains why a
      // participant appears once per day rather than once per scan.
      facts: [{ label: 'Day', value: row.day }],
      source: 'event_logs',
    };
  });
}

/** Workshop bookings and attendance — `GET /workshops/{id}/logs`. */
export function fromWorkshopLogs(rows: WorkshopLogRow[], names?: LogNames): LogEntry[] {
  return rows.map((row, i) => {
    const isAttendance = row.action === 'attendance';
    const actorId = row.scanned_by ?? row.participant_id;
    const who = personLabel(row.participant_id, names?.people) ?? 'A participant';
    const by = personLabel(row.scanned_by, names?.people);
    const targetName = names?.entities?.[row.workshop_id] ?? null;
    const where = targetName ? ` ${targetName}` : ' the workshop';

    return {
      key: `workshop-${row.workshop_id}-${row.action}-${row.participant_id}-${i}`,
      timestamp: row.timestamp,
      action: `WORKSHOP_${row.action.toUpperCase()}`,
      label: isAttendance ? 'Marked present' : 'Booked a place',
      sentence: isAttendance
        ? `${who} was marked present at${where}${by ? `, scanned by ${by}` : ''}`
        : `${who} booked a place at${where}`,
      kind: isAttendance ? 'attendance' : 'registration',
      domain: 'workshops',
      targetId: row.workshop_id,
      targetName,
      actorId,
      actorName: resolvedName(actorId, names?.people),
      actorMissing: Boolean(actorId) && !resolvedName(actorId, names?.people),
      actorRole: null,
      participantId: row.participant_id,
      participantName: resolvedName(row.participant_id, names?.people),
      facts: row.scan_type
        ? [{ label: 'Booking', value: row.scan_type === 'on-spot' ? 'On-spot' : 'Pre-registered' }]
        : [],
      source: 'workshop_logs',
    };
  });
}

/** Newest first, the order every log endpoint returns and readers expect. */
export function sortLogsNewestFirst(entries: LogEntry[]): LogEntry[] {
  return [...entries].sort((a, b) => b.timestamp.localeCompare(a.timestamp));
}

/** Formatted for display. Invalid timestamps are shown raw rather than as junk. */
export function formatLogTime(timestamp: string): string {
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? timestamp : date.toLocaleString();
}
