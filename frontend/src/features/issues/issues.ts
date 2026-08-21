import type {
  Hostel,
  Issue,
  IssueCreateRequest,
  IssueFacilityType,
  IssueStatus,
  IssueUpdate,
  Mess,
  MyHostelResponse,
  MyMessResponse,
  StaffIssue,
} from '@/api/types';
import type { BadgeTone } from '@/components/ui';

/**
 * Reporting a hostel or mess fault — Story 5.4, the pure half.
 *
 * Everything here mirrors a constraint the backend actually enforces, and that
 * is the point: `POST /issues` refuses a category the facility does not have, a
 * facility the caller is not placed in, a subject under 3 characters or over
 * 120, and an eleventh unresolved report against the same place. A form that
 * discovers those one 400 at a time is a form that wastes a participant's
 * evening, so the same rules are checked here before the request leaves — while
 * the server stays the authority, because it is the only one that can be.
 *
 * The catalogues below are therefore duplicated from `backend/routers/issues.py`
 * on purpose, in the same way `config/constants.ts` mirrors the mess preference
 * values `POST /mess/allocate` groups on. If the two ever disagree the backend
 * wins and this file is what gets corrected.
 *
 * No React and no `api` import: this module is where the rules live so both the
 * participant's form and the staff console can read them without either owning
 * them.
 */

/** Mirrors `MAX_OPEN_PER_FACILITY` in `backend/routers/issues.py`. */
export const MAX_OPEN_PER_FACILITY = 10;

/** Mirrors `Field(min_length=..., max_length=...)` on `IssueCreateRequest`. */
export const SUBJECT_MIN = 3;
export const SUBJECT_MAX = 120;
export const BODY_MIN = 3;
export const BODY_MAX = 2000;

/** One category a report can be filed under. */
export interface IssueCategory {
  value: string;
  label: string;
  /** What belongs here, so two people reporting one fault pick the same row. */
  hint: string;
}

/**
 * The categories each facility type accepts, mirroring `CATEGORIES` in
 * `backend/routers/issues.py`.
 *
 * They differ per facility because a burst pipe and a cold sambar are not the
 * same list, and offering a hostel resident "food quality" would produce a 400
 * they could not have predicted.
 */
export const ISSUE_CATEGORIES: Record<IssueFacilityType, IssueCategory[]> = {
  hostel: [
    {
      value: 'water',
      label: 'Water',
      hint: 'No supply, no hot water, a leak, or a blocked drain.',
    },
    {
      value: 'electricity',
      label: 'Electricity',
      hint: 'Lights, fans, sockets, or a tripped supply.',
    },
    { value: 'cleanliness', label: 'Cleanliness', hint: 'Room, corridor, or bathroom cleaning.' },
    {
      value: 'furniture',
      label: 'Furniture',
      hint: 'Bed, mattress, desk, chair, door, or window.',
    },
    { value: 'internet', label: 'Internet', hint: 'No wifi or a connection that keeps dropping.' },
    { value: 'safety', label: 'Safety', hint: 'Anything that could hurt somebody. Call as well.' },
    { value: 'noise', label: 'Noise', hint: 'Disturbance on the floor or outside the block.' },
    { value: 'other', label: 'Something else', hint: 'Anything the rows above do not cover.' },
  ],
  mess: [
    {
      value: 'food_quality',
      label: 'Food quality',
      hint: 'Undercooked, stale, cold, or not what was on the menu.',
    },
    {
      value: 'hygiene',
      label: 'Hygiene',
      hint: 'Utensils, counters, seating, or the serving area.',
    },
    { value: 'service', label: 'Service', hint: 'Ran out, long queue, or nobody at the counter.' },
    { value: 'timing', label: 'Timing', hint: 'The sitting opened late or closed early.' },
    {
      value: 'dietary',
      label: 'Dietary',
      hint: 'Your declared preference was not honoured at the counter.',
    },
    { value: 'other', label: 'Something else', hint: 'Anything the rows above do not cover.' },
  ],
};

/**
 * A stored category as a screen should print it.
 *
 * Falls back to de-underscoring the raw value rather than hiding it: a category
 * added to the backend before this file catches up should still read as words,
 * not vanish from a report the participant filed.
 */
export function categoryLabel(facilityType: IssueFacilityType, value: string): string {
  const known = ISSUE_CATEGORIES[facilityType]?.find((c) => c.value === value);
  if (known) return known.label;
  const words = value.replace(/_/g, ' ').trim();
  return words ? words[0].toUpperCase() + words.slice(1) : 'Uncategorised';
}

export const STATUS_LABEL: Record<IssueStatus, string> = {
  open: 'Open',
  in_progress: 'Being worked on',
  resolved: 'Resolved',
};

/**
 * Status → the same tones every other pill in the app uses.
 *
 * `open` is a warning rather than a danger: an unanswered report is the normal
 * first state of every report ever filed, and painting it red would make a
 * working queue look like a fault.
 */
export const STATUS_TONE: Record<IssueStatus, BadgeTone> = {
  open: 'warning',
  in_progress: 'info',
  resolved: 'success',
};

export function statusLabel(status: string): string {
  return STATUS_LABEL[status as IssueStatus] ?? status;
}

export function statusTone(status: string): BadgeTone {
  return STATUS_TONE[status as IssueStatus] ?? 'neutral';
}

/** "Ganga Block" / "Nilgiri Mess" — one place a participant can report about. */
export interface ReportableFacility {
  type: IssueFacilityType;
  /** The readable `hostel_id` or `mess_id` `POST /issues` expects. */
  id: string;
  /** The facility's own name, or its id when the catalogue read failed. */
  name: string;
  /** The room this participant is allotted, when the facility has rooms. */
  room: string | null;
}

/**
 * The places this participant may actually file against.
 *
 * Derived from the two `my_*` reads rather than the catalogues, because the
 * backend's placement check is the same fact: a hostel report needs
 * `accommodation.hostel_id` to match and a mess report needs `mess.mess_id` to
 * match, or it is a 403. Offering a block they are not in would be offering a
 * button that cannot work.
 *
 * The catalogues are consulted only to turn an id into a name, and a missing
 * catalogue degrades to showing the id rather than dropping the facility — the
 * report would still be filed correctly.
 */
export function reportableFacilities(input: {
  hostel: MyHostelResponse | null | undefined;
  mess: MyMessResponse | null | undefined;
  hostels?: readonly Hostel[] | null;
  messHalls?: readonly Mess[] | null;
}): ReportableFacility[] {
  const facilities: ReportableFacility[] = [];

  const hostelId = input.hostel?.assigned_hostel;
  if (hostelId) {
    const block = input.hostels?.find((h) => h.hostel_id === hostelId);
    facilities.push({
      type: 'hostel',
      id: hostelId,
      name: block?.name ?? hostelId,
      room: input.hostel?.room ?? null,
    });
  }

  const messId = input.mess?.allotted_mess;
  if (messId) {
    const hall =
      input.mess?.mess_details ?? input.messHalls?.find((m) => m.mess_id === messId) ?? null;
    facilities.push({
      type: 'mess',
      id: messId,
      name: hall?.name ?? messId,
      // A hall has no room, and inventing one would put a bed number on a
      // complaint about lunch.
      room: null,
    });
  }

  return facilities;
}

/** What the form holds while it is being filled in. */
export interface ReportDraft {
  facilityKey: string;
  category: string;
  subject: string;
  body: string;
  room: string;
}

export const EMPTY_DRAFT: ReportDraft = {
  facilityKey: '',
  category: '',
  subject: '',
  body: '',
  room: '',
};

/**
 * `hostel:GANGA` — one string a `<Select>` can hold for a facility that needs
 * two fields to identify. Kept in this module so the form and the parser cannot
 * disagree about the separator.
 */
export function facilityKey(facility: Pick<ReportableFacility, 'type' | 'id'>): string {
  return `${facility.type}:${facility.id}`;
}

export function findFacility(
  facilities: readonly ReportableFacility[],
  key: string,
): ReportableFacility | null {
  return facilities.find((f) => facilityKey(f) === key) ?? null;
}

/** Field name → message, empty when the draft is ready to send. */
export type DraftErrors = Partial<Record<keyof ReportDraft, string>>;

/**
 * Everything the backend would refuse, checked before asking it to.
 *
 * Deliberately not a superset: no rule is invented here that `POST /issues`
 * does not also enforce, so a draft this function accepts is one the server
 * accepts too, and a participant is never blocked by a rule that exists only in
 * the browser.
 */
export function validateDraft(
  draft: ReportDraft,
  facilities: readonly ReportableFacility[],
): DraftErrors {
  const errors: DraftErrors = {};
  const facility = findFacility(facilities, draft.facilityKey);

  if (!facility) {
    errors.facilityKey = 'Choose which block or hall this is about.';
  } else if (!ISSUE_CATEGORIES[facility.type].some((c) => c.value === draft.category)) {
    errors.category = draft.category
      ? 'That category does not apply here. Pick one from the list.'
      : 'Choose what kind of problem this is.';
  }

  const subject = draft.subject.trim();
  if (subject.length < SUBJECT_MIN) {
    errors.subject = `Give it a short title — at least ${SUBJECT_MIN} characters.`;
  } else if (subject.length > SUBJECT_MAX) {
    errors.subject = `Keep the title under ${SUBJECT_MAX} characters. Details go below.`;
  }

  const body = draft.body.trim();
  if (body.length < BODY_MIN) {
    errors.body = 'Describe the problem so the team knows what to bring.';
  } else if (body.length > BODY_MAX) {
    errors.body = `That is over the ${BODY_MAX}-character limit.`;
  }

  return errors;
}

/** A draft as `POST /issues` wants it, or `null` when it is not ready. */
export function draftToRequest(
  draft: ReportDraft,
  facilities: readonly ReportableFacility[],
): IssueCreateRequest | null {
  const facility = findFacility(facilities, draft.facilityKey);
  if (!facility) return null;
  if (Object.keys(validateDraft(draft, facilities)).length > 0) return null;

  const room = draft.room.trim();
  return {
    facility_type: facility.type,
    facility_id: facility.id,
    category: draft.category,
    subject: draft.subject.trim(),
    body: draft.body.trim(),
    // Omitted rather than sent empty: the backend falls back to the allotted
    // room, and sending `''` would talk it out of a value it already has.
    ...(room ? { room } : {}),
  };
}

/** A report still waiting on somebody. */
export function isOutstanding(issue: Pick<Issue, 'status'>): boolean {
  return issue.status !== 'resolved';
}

/**
 * How many unresolved reports this participant already holds against a facility.
 *
 * The screen uses this to say so *before* the eleventh is refused, because
 * "you already have 10 unresolved reports" is a much worse thing to read after
 * typing one than before.
 */
export function outstandingFor(
  issues: readonly Issue[],
  facility: Pick<ReportableFacility, 'type' | 'id'>,
): number {
  return issues.filter(
    (i) => i.facility_type === facility.type && i.facility_id === facility.id && isOutstanding(i),
  ).length;
}

export function atReportLimit(
  issues: readonly Issue[],
  facility: Pick<ReportableFacility, 'type' | 'id'>,
): boolean {
  return outstandingFor(issues, facility) >= MAX_OPEN_PER_FACILITY;
}

/** Counts for a summary row, over whichever list is in hand. */
export interface IssueCounts {
  total: number;
  open: number;
  in_progress: number;
  resolved: number;
  /** `open` + `in_progress` — what a duty team actually has to act on. */
  outstanding: number;
}

export function countIssues(issues: readonly Pick<Issue, 'status'>[]): IssueCounts {
  const counts: IssueCounts = {
    total: issues.length,
    open: 0,
    in_progress: 0,
    resolved: 0,
    outstanding: 0,
  };
  for (const issue of issues) {
    if (issue.status === 'open') counts.open += 1;
    else if (issue.status === 'in_progress') counts.in_progress += 1;
    else if (issue.status === 'resolved') counts.resolved += 1;
    if (isOutstanding(issue)) counts.outstanding += 1;
  }
  return counts;
}

/**
 * Work first, then history — the order a duty board should read in.
 *
 * The API already sorts newest first, which is right for the participant's own
 * list but wrong for a queue: a volunteer wants the unanswered ones at the top
 * regardless of age, and a resolved report from an hour ago is not more
 * important than an open one from yesterday. Within a status the API's ordering
 * is kept, so this is stable and does not re-sort on every poll.
 */
const STATUS_RANK: Record<IssueStatus, number> = { open: 0, in_progress: 1, resolved: 2 };

export function sortForDuty<T extends Pick<Issue, 'status'>>(issues: readonly T[]): T[] {
  return [...issues].sort((a, b) => (STATUS_RANK[a.status] ?? 3) - (STATUS_RANK[b.status] ?? 3));
}

/** The most recent thing anybody said, or `null` when nobody has yet. */
export function latestUpdate(issue: Pick<Issue, 'updates'>): IssueUpdate | null {
  const updates = issue.updates ?? [];
  return updates.length > 0 ? updates[updates.length - 1] : null;
}

/**
 * The last note anybody wrote, skipping bare status changes.
 *
 * A status change with no note is real history and stays in the timeline, but it
 * is not an answer — surfacing it as the summary line would show a participant
 * "Resolved" with nothing under it where they expected to read what was done.
 */
export function latestNote(issue: Pick<Issue, 'updates'>): IssueUpdate | null {
  for (let i = (issue.updates ?? []).length - 1; i >= 0; i -= 1) {
    const update = issue.updates[i];
    if (update.note) return update;
  }
  return null;
}

/**
 * A report as a text message, for the phone hand-off beside the ticket.
 *
 * The ticket is the record; a call or an SMS is what a participant does at 2am
 * about a burst pipe, and the two are complementary rather than alternatives.
 * The reference is included first so the volunteer who picks up can find the
 * same report on their own screen instead of taking the details down twice.
 */
export function issueSmsBody(issue: Issue, facilityName: string): string {
  const room = issue.room ? ` (room ${issue.room})` : '';
  return [
    `Paradox issue ${issue.issue_id}`,
    `${facilityName}${room}`,
    `${categoryLabel(issue.facility_type, issue.category)}: ${issue.subject}`,
    issue.body,
  ].join('\n');
}

/** The same, for a draft that has not been filed yet. */
export function draftSmsBody(draft: ReportDraft, facility: ReportableFacility): string {
  const room = (draft.room.trim() || facility.room || '').trim();
  return [
    'Paradox issue report',
    `${facility.name}${room ? ` (room ${room})` : ''}`,
    `${categoryLabel(facility.type, draft.category)}: ${draft.subject.trim()}`,
    draft.body.trim(),
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * A report's timestamp as a person should read it.
 *
 * This does **not** reuse `formatDateTime` from `features/events/eventView.ts`,
 * and the difference matters. That helper formats strings an organiser typed
 * into a `datetime-local` input, which are genuinely local wall-clock times.
 * These come from `datetime.utcnow()` on the backend and are serialised *naive* —
 * `2026-08-20T14:22:31.123456`, with no offset — and ECMAScript reads a
 * date-time form with no offset as **local**. So handing one to `new Date` puts
 * every report 5½ hours out in India, which for a fault reported at 9pm reads as
 * tomorrow.
 *
 * The `Z` is therefore appended when the string carries no offset of its own,
 * and left alone when it does, so this stays correct if the backend ever starts
 * sending timezone-aware values.
 */
const HAS_OFFSET = /(?:Z|[+-]\d{2}:?\d{2})$/;

/**
 * A backend timestamp as an instant, or `null` when it is not a date.
 *
 * Exported because "how old is this" is a separate question from "how does this
 * read", and the dashboard's staleness rules need the former without the
 * formatting. `null` rather than an epoch date: a rule that cannot tell the age
 * of a report must decline to fire rather than call it decades overdue.
 */
export function parseIssueTime(value: string | null | undefined): Date | null {
  const text = (value ?? '').trim();
  if (!text) return null;

  const date = new Date(HAS_OFFSET.test(text) ? text : `${text}Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatIssueTime(value: string | null | undefined): string {
  const text = (value ?? '').trim();
  if (!text) return '';

  const date = parseIssueTime(text);
  if (date === null) return text;

  return date.toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
}

/**
 * "Anita Rao · 9876500011 · room 101" — the reporter on one line.
 *
 * Every part is optional because every part can be absent: a participant who
 * never completed their profile has no name on file, and a mess report has no
 * room. Falls back to the participant id, which is always present, so a row is
 * never headed by nothing.
 */
export function reporterLine(issue: StaffIssue): string {
  const parts = [
    issue.reporter.name?.trim() || issue.reporter.participant_id,
    issue.reporter.phone?.trim() || '',
    issue.reporter.room?.trim() ? `room ${issue.reporter.room.trim()}` : '',
  ];
  return parts.filter(Boolean).join(' · ');
}
