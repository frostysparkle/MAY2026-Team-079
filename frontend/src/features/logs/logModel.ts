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
  kind: LogKind;
  /** Which section this belongs to, when known. */
  domain: LogDomain | null;
  /** The entity this concerns — an event_id, workshop_id, mess_id, hostel_id. */
  targetId: string | null;
  /** Who performed it. */
  actorId: string | null;
  /** Who it was performed on, when the record names someone. */
  participantId: string | null;
  facts: LogFact[];
  /** Where the record came from, shown so a reader can go check the source. */
  source: 'audit' | 'event_logs' | 'workshop_logs';
}

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
 * Turn a details object into facts.
 *
 * `participant_id` is pulled out by the caller and shown as its own field, so it
 * is skipped here. Everything else is rendered — recognised keys get a nicer
 * label, unrecognised keys are shown under their own name so nothing recorded is
 * invisible.
 */
function factsFromDetails(details: Record<string, unknown> | undefined): LogFact[] {
  if (!details) return [];

  const facts: LogFact[] = [];
  for (const [key, value] of Object.entries(details)) {
    if (key === 'participant_id') continue;
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

/* ------------------------------------------------------------ adapters --- */

/** Audit trail entries — the broadest source, and the only one for mess/hostels. */
export function fromAuditLogs(logs: AuditLogEntry[]): LogEntry[] {
  return logs.map((log, i) => {
    const { kind, label } = describeAuditAction(log.action);
    const participantId =
      typeof log.details?.participant_id === 'string' ? log.details.participant_id : null;

    return {
      key: `audit-${log.timestamp}-${log.action}-${log.target_id ?? ''}-${i}`,
      timestamp: log.timestamp,
      action: log.action,
      label,
      kind,
      domain: domainOfAction(log.action),
      targetId: log.target_id ?? null,
      actorId: log.actor_id,
      participantId,
      facts: factsFromDetails(log.details),
      source: 'audit',
    };
  });
}

/** Event attendance scans — `GET /events/{id}/logs`. */
export function fromEventLogs(rows: EventLogRow[]): LogEntry[] {
  return rows.map((row, i) => ({
    key: `event-${row.event_id}-${row.participant_id}-${row.day}-${i}`,
    timestamp: row.timestamp,
    action: 'EVENT_ATTENDANCE',
    label: 'Attendance scanned',
    kind: 'attendance',
    domain: 'events',
    targetId: row.event_id,
    actorId: row.scanned_by,
    participantId: row.participant_id,
    // The day is the field the scan endpoint dedupes on, so it explains why a
    // participant appears once per day rather than once per scan.
    facts: [{ label: 'Day', value: row.day }],
    source: 'event_logs',
  }));
}

/** Workshop bookings and attendance — `GET /workshops/{id}/logs`. */
export function fromWorkshopLogs(rows: WorkshopLogRow[]): LogEntry[] {
  return rows.map((row, i) => {
    const isAttendance = row.action === 'attendance';
    return {
      key: `workshop-${row.workshop_id}-${row.action}-${row.participant_id}-${i}`,
      timestamp: row.timestamp,
      action: `WORKSHOP_${row.action.toUpperCase()}`,
      label: isAttendance ? 'Marked present' : 'Booked a place',
      kind: isAttendance ? 'attendance' : 'registration',
      domain: 'workshops',
      targetId: row.workshop_id,
      actorId: row.scanned_by ?? row.participant_id,
      participantId: row.participant_id,
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
