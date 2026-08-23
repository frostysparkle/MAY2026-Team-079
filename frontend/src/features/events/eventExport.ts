/**
 * Saving an event to a file — its details, and who registered for it.
 *
 * Two exports rather than one, because they are two different shapes and a
 * spreadsheet cannot hold both. The roster is tabular: one row per registrant,
 * the same seven fields `GET /events/{id}/participation` returns. The details are
 * not tabular at all — an event is one record with a handful of nested lists
 * (rounds, prizes, team, entry rules) — so they export in long form,
 * `section,field,value`, which keeps a four-round event and a no-round event the
 * same file layout and needs no column per round.
 *
 * ## What is in the details file, and what cannot be
 *
 * Everything here is already on the organiser's screen: it comes from the
 * `GET /events` record (via `fullEventView`, so the wording matches the event
 * page exactly, prize strings and round times included) plus the two counts on
 * the participation response. This adds no visibility, only a way to keep what is
 * already visible.
 *
 * `total_daily_scans` is absent for UHC callers, and the file says so in words
 * rather than writing `0` — a blank gate reading and a gate nobody walked through
 * are not the same fact, and a spreadsheet cannot ask a follow-up question.
 */
import type { Event, EventParticipant, EventParticipationResponse } from '@/api/types';
import { downloadCsv, toCsv } from '@/lib/csv';
import { readEventCapacity } from './eventCapacity';
import { readEventExtras, readRegistrationWindow } from './eventExtras';
import { eventRegistrants } from './eventRoster';
import { eventTeamRoleLabel, isReachablePhone, orderEventTeam } from './eventTeam';
import { formatDateTime, fullEventView } from './eventView';

/* ---------------------------------------------------------------- roster --- */

/** One exported registrant. Flat and string-keyed, which is what `toCsv` takes. */
export interface EventRosterCsvRow {
  participant_id: string;
  name: string;
  email: string;
  phone: string;
  house: string;
  programme: string;
  entry_cohort: string;
  team_id: string;
  team_role: string;
}

/**
 * The roster's columns, and the whole of what an Event Head can learn about a
 * registrant.
 *
 * Seven of these come straight from the participation response; `programme` and
 * `entry_cohort` are derived from the roll number by `eventRegistrants`. The header
 * is therefore not an editorial choice about what is worth exporting — it is the
 * complete set of fields available to the person doing the export.
 *
 * `entry_cohort` rather than a level column, and the distinction is the point: the
 * academic level lives in `profile.course_stage`, which no endpoint an Event Head
 * may call returns for an event's registrants. A column headed "degree level" filled
 * with entry years would be a spreadsheet that lies quietly for the rest of its life.
 */
export const EVENT_ROSTER_COLUMNS: (keyof EventRosterCsvRow)[] = [
  'participant_id',
  'name',
  'email',
  'phone',
  'house',
  'programme',
  'entry_cohort',
  'team_id',
  'team_role',
];

export function toEventRosterCsvRows(
  participants: readonly EventParticipant[],
): EventRosterCsvRow[] {
  return eventRegistrants(participants).map((row) => ({
    participant_id: row.participantId,
    // Empty rather than a placeholder: a blank cell reads unmistakably as "not
    // known", where "Unknown" is a name somebody could sort by.
    name: row.name ?? '',
    email: row.email,
    phone: row.phone ?? '',
    house: row.house ?? '',
    programme: row.programme ?? '',
    entry_cohort: row.entryYear === null ? '' : String(row.entryYear),
    team_id: row.teamId ?? '',
    team_role: row.teamRole ?? '',
  }));
}

export function exportEventRoster(
  eventId: string,
  participants: readonly EventParticipant[],
): void {
  downloadCsv(
    `event-${eventId}-registrations.csv`,
    toCsv(toEventRosterCsvRows(participants), EVENT_ROSTER_COLUMNS),
  );
}

/* --------------------------------------------------------------- details --- */

export interface EventDetailCsvRow {
  section: string;
  field: string;
  value: string;
}

export const EVENT_DETAIL_COLUMNS: (keyof EventDetailCsvRow)[] = ['section', 'field', 'value'];

/** Absent counts read as a sentence, never as a zero. See the module comment. */
const NOT_READABLE = 'not readable from this account';

/**
 * An event as a list of `section, field, value` rows.
 *
 * `participation` is optional so the caller can export an event's details from a
 * screen that has not loaded a roster; the registration and attendance rows are
 * simply omitted rather than guessed at.
 */
export function toEventDetailCsvRows(
  event: Event,
  participation?: Pick<EventParticipationResponse, 'count' | 'total_daily_scans' | 'event_team'>,
): EventDetailCsvRow[] {
  const view = fullEventView(event);
  const extras = readEventExtras(event.registration);
  const window = readRegistrationWindow(event.registration);
  const rows: EventDetailCsvRow[] = [];
  const add = (section: string, field: string, value: string | number | boolean | undefined) => {
    if (value === undefined || value === '') return;
    rows.push({
      section,
      field,
      value: typeof value === 'boolean' ? (value ? 'yes' : 'no') : String(value),
    });
  };

  add('Event', 'Event ID', event.event_id);
  add('Event', 'Name', event.name);
  add('Event', 'Type', event.event_type);
  add('Event', 'Registration', event.registration.is_open ? 'open' : 'closed');
  add('Event', 'Description', event.description);

  add('Registration', 'Opens', formatDateTime(window.startTime));
  add('Registration', 'Closes', formatDateTime(window.endTime));
  add('Registration', 'Published capacity', extras.capacity);

  if (participation) {
    add('Registration', 'Registered', participation.count);

    // `'total_daily_scans' in response` is the documented test — the key is
    // absent for UHC callers rather than null, so `?? null` would not tell the
    // difference between "not sent" and "sent as zero".
    const scans =
      typeof participation.total_daily_scans === 'number' ? participation.total_daily_scans : null;
    add('Attendance', 'Unique scans today', scans === null ? NOT_READABLE : scans);

    const capacity = readEventCapacity(extras.capacity, scans);
    if (capacity) {
      add(
        'Attendance',
        'Entries left today',
        capacity.remaining === null ? NOT_READABLE : capacity.remaining,
      );
      if (capacity.over > 0) add('Attendance', 'Past published capacity', capacity.over);
    }
  }

  add('Team rules', 'Minimum size', event.team.min);
  add('Team rules', 'Maximum size', event.team.max);
  add('Team rules', 'House-only teams', event.team.house_vs_house_event);
  add('Team rules', 'Single entries allowed', event.team.allow_single_registration);

  // `view.timeline` and `view.prizes` are the event page's own strings, display
  // overrides applied — so an exported round time reads the way the organiser
  // published it rather than as a raw ISO stamp.
  view.timeline.forEach((round, index) => {
    add(
      'Schedule',
      `Round ${index + 1}`,
      [round.name, round.when, round.venue].filter(Boolean).join(' · '),
    );
  });

  view.prizes.forEach((prize) => add('Prizes', prize.label, prize.amount));

  add('Entry', 'Reporting time', extras.entry.reportingTime);
  add('Entry', 'ID proof', extras.entry.idProof);
  add('Entry', 'Allowed items', extras.entry.allowedItems.join('; '));
  add('Entry', 'Entry rules', extras.entry.rules.join('; '));

  // The team as the participation response reports it, which is the only place a
  // member's name and phone are readable. Falls back to the event record's bare
  // `{user_id, role}` when no roster was loaded, so the section is never missing
  // entirely — a details file with no team on it looks like an unstaffed event.
  const team: { user_id: string; role: string; name?: string; phone?: string }[] =
    participation?.event_team ?? event.event_team;
  orderEventTeam(team).forEach((member) => {
    const name = member.name || member.user_id;
    add(
      'Event team',
      eventTeamRoleLabel(member.role),
      isReachablePhone(member.phone) ? `${name} · ${member.phone}` : name,
    );
  });

  return rows;
}

export function exportEventDetails(
  event: Event,
  participation?: Pick<EventParticipationResponse, 'count' | 'total_daily_scans' | 'event_team'>,
): void {
  downloadCsv(
    `event-${event.event_id}-details.csv`,
    toCsv(toEventDetailCsvRows(event, participation), EVENT_DETAIL_COLUMNS),
  );
}
