import type { Workshop, WorkshopLogRow, WorkshopParticipationRow } from '@/api/types';
import { parseParticipantId, PROGRAM_LABEL } from '@/features/participants/participantId';

/**
 * Who booked a workshop, who turned up, and who did not — derived from the only
 * per-person record the API exposes for a workshop: its log.
 *
 * `GET /workshops/{id}/logs` writes one row per booking (`action: "registration"`)
 * and one per turnstile scan (`action: "attendance"`, with `scan_type` separating
 * a pre-registered attendee from an on-spot admission). Nothing else in the
 * backend reports a workshop's roster: there is no `/workshops/{id}/participation`
 * to mirror the events one, and no endpoint returns another participant's profile.
 * So this module reconstructs the roster from those rows, and everything the
 * dashboard shows about a *person* comes from here.
 *
 * Two consequences are deliberate and surfaced in the UI rather than hidden:
 *
 *  - A roster entry is identified by `participant_id` — the student's roll number
 *    in `PROGRAM + ROLL` form, which is what `POST /auth/register` derives and
 *    what their QR carries. No name, email, or phone is available for a workshop
 *    registrant anywhere in the API.
 *  - The log is Super Admin-only. A volunteer or workshop manager who is not a
 *    Super Admin gets counts from `GET /workshops` (which any staff token may
 *    read) plus the scans made on their own device, and the dashboard says so.
 */

/** How a seat was taken. Mirrors `workshops[].booking_type` on the participant. */
export type WorkshopBooking = 'pre-registered' | 'on-spot';

/**
 * Where the knowledge of this person came from, best first.
 *
 * `roster` is `GET /workshops/{id}/participation` — the server's own answer,
 * carrying a name and an academic level. `log` is a row reconstructed from
 * `GET /workshops/{id}/logs`, which has timestamps but no identity beyond the id.
 * `device` is a scan made on this device and known nowhere else yet.
 */
export type RosterSource = 'roster' | 'log' | 'device';

export interface RosterEntry {
  /** `DS23F3001726` — the roll-number id the backend derives from the email. */
  participantId: string;
  booking: WorkshopBooking;
  attended: boolean;
  /** From the roster route only; null when the entry came from a log or a scan. */
  name: string | null;
  email: string | null;
  phone: string | null;
  house: string | null;
  /** `diploma` — `profile.course_stage`, the three-value field the app reports on. */
  courseStage: string | null;
  /** `Diploma` — `profile.academic_level`, the four-value academic ladder. */
  academicLevel: string | null;
  /** ISO timestamp of the booking row, when there is one. */
  registeredAt: string | null;
  /** ISO timestamp of the attendance scan, when they were scanned. */
  attendedAt: string | null;
  /** The staff id that scanned them in. */
  scannedBy: string | null;
  /** `DS`, when the id parses. */
  program: string | null;
  /** `Data Science`, when the id parses. */
  programLabel: string | null;
  /** `2023`, from the roll number's first two digits. */
  entryYear: number | null;
  source: RosterSource;
}

/**
 * The roll-number derivations now live in `features/participants/participantId`,
 * because the event roster reads them too and neither module owns them. Re-exported
 * so this module's own call sites — and the tests that cover them here — keep
 * reaching them from where they have always been.
 */
export { PROGRAM_LABEL, parseParticipantId } from '@/features/participants/participantId';

function blankEntry(participantId: string, source: RosterSource): RosterEntry {
  const { program, entryYear } = parseParticipantId(participantId);
  return {
    participantId,
    booking: 'pre-registered',
    attended: false,
    name: null,
    email: null,
    phone: null,
    house: null,
    courseStage: null,
    academicLevel: null,
    registeredAt: null,
    attendedAt: null,
    scannedBy: null,
    program,
    programLabel: program ? PROGRAM_LABEL[program] : null,
    entryYear,
    source,
  };
}

/**
 * The roster as the server reports it — one entry per person who holds a seat.
 *
 * This is the authoritative shape: `attended` and `booking_type` are read from the
 * participant's own record rather than inferred from scan rows, and the profile
 * fields are the ones no log could carry. Timestamps are absent, which is why
 * `mergeParticipation` layers this over a log-built roster rather than replacing
 * it when both are readable.
 */
export function fromParticipation(rows: WorkshopParticipationRow[]): RosterEntry[] {
  return sortRoster(rows.map(participationEntry));
}

function participationEntry(row: WorkshopParticipationRow): RosterEntry {
  const entry = blankEntry(row.participant_id, 'roster');
  entry.booking = row.booking_type === 'on-spot' ? 'on-spot' : 'pre-registered';
  entry.attended = Boolean(row.attended);
  entry.name = row.name ?? null;
  entry.email = row.email ?? null;
  entry.phone = row.phone ?? null;
  entry.house = row.house ?? null;
  entry.courseStage = row.course_stage ?? null;
  entry.academicLevel = row.academic_level ?? null;
  // The profile's own programme wins over the two letters in the id — same value
  // in practice, but one is stored and the other is parsed.
  if (row.program) {
    entry.program = row.program;
    entry.programLabel = PROGRAM_LABEL[row.program] ?? row.program;
  }
  if (typeof row.entry_year === 'number') entry.entryYear = row.entry_year;
  return entry;
}

/**
 * Overlay the server's roster on a log-built one, keeping the log's timestamps.
 *
 * For a Super Admin both are readable and each knows something the other does not:
 * the roster has names, levels, and the current attendance state; the log has when
 * the booking and the scan happened. Where they disagree the roster wins, because
 * it is the participant's record and the log is a history of events against it —
 * an attendance corrected through `PATCH .../participants/{id}` is visible in the
 * first and contradicted by the second.
 */
export function mergeParticipation(
  entries: RosterEntry[],
  rows: WorkshopParticipationRow[],
): RosterEntry[] {
  const byParticipant = new Map(entries.map((entry) => [entry.participantId, { ...entry }]));

  for (const row of rows) {
    const fromServer = participationEntry(row);
    const existing = byParticipant.get(row.participant_id);
    byParticipant.set(row.participant_id, {
      ...fromServer,
      registeredAt: existing?.registeredAt ?? null,
      attendedAt: existing?.attendedAt ?? null,
      scannedBy: existing?.scannedBy ?? null,
    });
  }

  return sortRoster([...byParticipant.values()]);
}

/**
 * Fold a workshop's log rows into one entry per person.
 *
 * Order within the log is not trusted: a booking row and an attendance row are
 * applied to the same entry whichever arrives first, and the earliest timestamp
 * of each kind wins so a re-scan cannot rewrite when somebody actually arrived.
 *
 * An on-spot scan sets `booking` to `on-spot` even when a booking row exists for
 * the same person — that is exactly what the backend does to the participant's
 * own record, pulling the pre-registered entry for the slot and pushing an
 * on-spot one in its place.
 */
export function buildRoster(logs: WorkshopLogRow[]): RosterEntry[] {
  const byParticipant = new Map<string, RosterEntry>();

  const entryFor = (participantId: string) => {
    const existing = byParticipant.get(participantId);
    if (existing) return existing;
    const created = blankEntry(participantId, 'log');
    byParticipant.set(participantId, created);
    return created;
  };

  for (const row of logs) {
    if (!row.participant_id) continue;
    const entry = entryFor(row.participant_id);

    if (row.action === 'registration') {
      entry.registeredAt = earliest(entry.registeredAt, row.timestamp);
      continue;
    }

    if (row.action === 'attendance') {
      entry.attended = true;
      entry.attendedAt = earliest(entry.attendedAt, row.timestamp);
      entry.scannedBy = entry.scannedBy ?? row.scanned_by ?? null;
      if (row.scan_type === 'on-spot') entry.booking = 'on-spot';
    }
  }

  return sortRoster([...byParticipant.values()]);
}

function earliest(current: string | null, candidate: string): string {
  if (!current) return candidate;
  return candidate < current ? candidate : current;
}

/** Absentees first is never useful; roll-number order is what a door list uses. */
export function sortRoster(entries: RosterEntry[]): RosterEntry[] {
  return [...entries].sort((a, b) => a.participantId.localeCompare(b.participantId));
}

/**
 * Add scans this device made to a roster that may not include them.
 *
 * For a Super Admin the log is the whole truth and the ledger only confirms it,
 * so a log entry always wins and the device rows change nothing. For a volunteer
 * the log is a 403 and the ledger is the *only* record of who they let in —
 * without this merge their dashboard could show counts and no names at all.
 */
export function mergeDeviceScans(
  entries: RosterEntry[],
  scans: { participantId: string; scanType: WorkshopBooking; at: string; scannedBy?: string }[],
): RosterEntry[] {
  const byParticipant = new Map(entries.map((entry) => [entry.participantId, { ...entry }]));

  for (const scan of scans) {
    const existing = byParticipant.get(scan.participantId);
    const entry = existing ?? blankEntry(scan.participantId, 'device');
    entry.attended = true;
    entry.attendedAt = earliest(entry.attendedAt, scan.at);
    entry.scannedBy = entry.scannedBy ?? scan.scannedBy ?? null;
    if (scan.scanType === 'on-spot') entry.booking = 'on-spot';
    byParticipant.set(scan.participantId, entry);
  }

  return sortRoster([...byParticipant.values()]);
}

/* ------------------------------------------------------------------ counts --- */

export interface WorkshopAttendanceCounts {
  capacity: number;
  /**
   * Seats taken, as the workshop record reports them. `registration_count`
   * counts on-spot admissions too — the on-spot branch increments it alongside
   * `participant_count` — so this is "seats gone", not "pre-registrations".
   */
  registered: number;
  /** Everyone marked present, pre-registered and on-spot alike. */
  attended: number;
  /** Booked and did not turn up. Never negative. */
  notAttended: number;
  seatsLeft: number;
  /** Attended over registered, as a percentage. Null when nobody registered. */
  showRate: number | null;
  /** The backend's cap: `int(capacity * 0.1)`. */
  onSpotAllowance: number;
  /** On-spot admissions, when the log or the device ledger can be read. */
  onSpotAdmitted: number | null;
  /** On-spot places left against the 10% cap. Null when the count is unknown. */
  onSpotLeft: number | null;
}

/**
 * Headline figures, taken from the workshop record rather than from the log.
 *
 * Deliberate: `registration_count` and `participant_count` come back from
 * `GET /workshops` for *any* staff token, so every volunteer sees real
 * attendance figures even when the roster behind them is not readable. The log
 * only refines the split, by naming how many of the attendees walked in on-spot.
 */
export function attendanceCounts(
  workshop: Pick<Workshop, 'capacity' | 'registration_count' | 'participant_count'>,
  onSpotAdmitted: number | null = null,
): WorkshopAttendanceCounts {
  const capacity = Math.max(0, workshop.capacity ?? 0);
  const registered = Math.max(0, workshop.registration_count ?? 0);
  const attended = Math.max(0, workshop.participant_count ?? 0);
  const onSpotAllowance = Math.floor(capacity * 0.1);

  return {
    capacity,
    registered,
    attended,
    notAttended: Math.max(0, registered - attended),
    seatsLeft: Math.max(0, capacity - registered),
    showRate: registered > 0 ? (attended / registered) * 100 : null,
    onSpotAllowance,
    onSpotAdmitted,
    onSpotLeft: onSpotAdmitted === null ? null : Math.max(0, onSpotAllowance - onSpotAdmitted),
  };
}

/* ------------------------------------------------------------------- lists --- */

export interface RosterLists {
  /** Everyone the log or ledger knows about. */
  all: RosterEntry[];
  /** Booked ahead and scanned in. */
  attended: RosterEntry[];
  /** Booked ahead and never scanned. */
  absent: RosterEntry[];
  /** Admitted at the door, with no prior booking for this workshop. */
  onSpot: RosterEntry[];
}

export function rosterLists(entries: RosterEntry[]): RosterLists {
  return {
    all: entries,
    attended: entries.filter((e) => e.booking === 'pre-registered' && e.attended),
    absent: entries.filter((e) => e.booking === 'pre-registered' && !e.attended),
    onSpot: entries.filter((e) => e.booking === 'on-spot'),
  };
}

/* ------------------------------------------------------------------ charts --- */

export interface InterestBucket {
  key: string;
  label: string;
  value: number;
}

/**
 * What the buckets are keyed on.
 *
 * `level` is the real thing — `profile.course_stage`, now carried per registrant by
 * `GET /workshops/{id}/participation`. `cohort` (the entry year in the roll number)
 * remains as the fallback for a roster that could only be rebuilt from log rows,
 * where no profile field is available at all: it is a year group, not a level, and
 * the chart says so rather than passing one off as the other.
 */
export type InterestBasis = 'level' | 'cohort' | 'programme';

/** `profile.course_stage` values, in the order a student passes through them. */
export const COURSE_STAGE_ORDER = ['foundational', 'diploma', 'degree'] as const;

export const COURSE_STAGE_LABEL: Record<string, string> = {
  foundational: 'Foundation',
  diploma: 'Diploma',
  degree: 'Degree',
};

/** `diploma` → `Diploma`. An unrecognised value is shown as stored. */
export function levelLabel(courseStage: string | null): string {
  if (!courseStage) return 'Unknown';
  return COURSE_STAGE_LABEL[courseStage] ?? courseStage;
}

export interface InterestBreakdown {
  basis: InterestBasis;
  buckets: InterestBucket[];
  /** Ids that did not parse — staff-shaped or non-IITM. Reported, not dropped. */
  unknown: number;
  /** People the breakdown could be computed for. */
  counted: number;
}

/**
 * Interest by academic level — how many Foundation, Diploma and Degree students
 * hold a seat at this workshop.
 *
 * The three stages are always present, in ladder order, even at zero: an empty
 * Foundation column is the answer "none signed up", where a missing column reads
 * as a rendering fault. A stage the backend has never heard of is appended after
 * them rather than dropped, and a registrant with no completed profile is counted
 * in `unknown` instead of being quietly assigned a level.
 */
export function interestByLevel(entries: RosterEntry[]): InterestBreakdown {
  const counts = new Map<string, number>(COURSE_STAGE_ORDER.map((stage) => [stage, 0]));
  let unknown = 0;

  for (const entry of entries) {
    if (!entry.courseStage) {
      unknown += 1;
      continue;
    }
    counts.set(entry.courseStage, (counts.get(entry.courseStage) ?? 0) + 1);
  }

  const known = [...counts.entries()].sort(([a], [b]) => rankStage(a) - rankStage(b));

  return {
    basis: 'level',
    buckets: known.map(([stage, value]) => ({
      key: stage,
      label: levelLabel(stage),
      value,
    })),
    unknown,
    counted: entries.length - unknown,
  };
}

function rankStage(stage: string): number {
  const index = COURSE_STAGE_ORDER.indexOf(stage as (typeof COURSE_STAGE_ORDER)[number]);
  return index === -1 ? COURSE_STAGE_ORDER.length : index;
}

/**
 * Interest by entry cohort — how many of the people who registered came from
 * each year group, oldest first so the axis reads as a scale.
 */
export function interestByCohort(entries: RosterEntry[]): InterestBreakdown {
  const counts = new Map<number, number>();
  let unknown = 0;

  for (const entry of entries) {
    if (entry.entryYear === null) {
      unknown += 1;
      continue;
    }
    counts.set(entry.entryYear, (counts.get(entry.entryYear) ?? 0) + 1);
  }

  return {
    basis: 'cohort',
    buckets: [...counts.entries()]
      .sort(([a], [b]) => a - b)
      .map(([year, value]) => ({ key: String(year), label: `${year} entry`, value })),
    unknown,
    counted: entries.length - unknown,
  };
}

/** Interest by programme, biggest first — DS dwarfs the rest, so ranked. */
export function interestByProgramme(entries: RosterEntry[]): InterestBreakdown {
  const counts = new Map<string, number>();
  let unknown = 0;

  for (const entry of entries) {
    if (!entry.program) {
      unknown += 1;
      continue;
    }
    counts.set(entry.program, (counts.get(entry.program) ?? 0) + 1);
  }

  return {
    basis: 'programme',
    buckets: [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([program, value]) => ({
        key: program,
        label: PROGRAM_LABEL[program] ?? program,
        value,
      })),
    unknown,
    counted: entries.length - unknown,
  };
}

/* --------------------------------------------------------------------- csv --- */

/** One exported row. Flat and string-keyed, which is what `toCsv` takes. */
export interface RosterCsvRow {
  participant_id: string;
  name: string;
  email: string;
  phone: string;
  house: string;
  programme: string;
  level: string;
  academic_level: string;
  entry_year: string;
  booking_type: string;
  attended: string;
  registered_at: string;
  attended_at: string;
  scanned_by: string;
  record_source: string;
}

export const ROSTER_CSV_COLUMNS: (keyof RosterCsvRow)[] = [
  'participant_id',
  'name',
  'email',
  'phone',
  'house',
  'programme',
  'level',
  'academic_level',
  'entry_year',
  'booking_type',
  'attended',
  'registered_at',
  'attended_at',
  'scanned_by',
  'record_source',
];

const SOURCE_LABEL: Record<RosterSource, string> = {
  roster: 'workshop roster',
  log: 'workshop log',
  device: 'this device',
};

export function toRosterCsvRows(entries: RosterEntry[]): RosterCsvRow[] {
  return entries.map((entry) => ({
    participant_id: entry.participantId,
    // Empty rather than a placeholder: a blank cell in a spreadsheet is
    // unmistakably "not known", where "Unknown" is a name somebody could sort by.
    name: entry.name ?? '',
    email: entry.email ?? '',
    phone: entry.phone ?? '',
    house: entry.house ?? '',
    programme: entry.programLabel ?? '',
    level: entry.courseStage ? levelLabel(entry.courseStage) : '',
    academic_level: entry.academicLevel ?? '',
    entry_year: entry.entryYear === null ? '' : String(entry.entryYear),
    booking_type: entry.booking,
    attended: entry.attended ? 'yes' : 'no',
    registered_at: entry.registeredAt ?? '',
    attended_at: entry.attendedAt ?? '',
    scanned_by: entry.scannedBy ?? '',
    record_source: SOURCE_LABEL[entry.source],
  }));
}
