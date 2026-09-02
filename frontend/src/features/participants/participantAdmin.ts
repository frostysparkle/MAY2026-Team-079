import type { Hostel, ParticipantAdminUpdateRequest, ParticipantRecord } from '@/api/types';
import { HOUSES, bareHouse } from '@/config/houses';

/**
 * Editing somebody else's record — Story 7.3, the pure half.
 *
 * The admin dashboard could already *view* every roster and could not *update*
 * anybody, because no endpoint wrote to a participant document except that
 * participant's own `PATCH /profile/complete`. `PATCH /participants/{id}` closes
 * that, and this module holds the two rules worth stating once rather than in
 * every component: which fields are editable, and what counts as a change.
 *
 * The editable set is deliberately narrower than a profile. Identity (`email`,
 * `participant_id`), credentials, and allocation state are all absent, because
 * the routes that own them enforce things a direct write would skip — capacity,
 * scan state, and the email-to-id derivation every roster and QR payload joins
 * on. The backend refuses them too; this is not the only line of defence, it is
 * the one that keeps a form from offering a field that cannot be saved.
 */

/** One field an admin may correct, and how to render its control. */
export interface EditableField {
  key: keyof ParticipantAdminUpdateRequest & string;
  label: string;
  /** `select` fields carry their own vocabulary; everything else is free text. */
  options?: readonly string[];
  /** Free text over one line gets a textarea. */
  multiline?: boolean;
  hint?: string;
}

/**
 * `ParticipantAdminUpdateRequest` validates `house`, `gender`, `program` and
 * `course_stage` against the exact same closed sets `ProfileCompleteRequest`
 * does (`backend/models.py`'s `_valid_house` / `_valid_gender` / `_valid_program`
 * / `_valid_course_stage` field validators, shared by both request models) — so
 * these dropdowns have to offer the backend's real values, not a looser
 * approximation, or a save 422s for a field that looked like free choice. A
 * record already holding something outside the set keeps it rather than being
 * silently coerced (see `editableValue`).
 */
export const GENDERS = ['male', 'female'] as const;
export const PROGRAMS = ['DS', 'ES', 'AE', 'MS'] as const;
export const COURSE_STAGES = ['foundational', 'diploma', 'degree'] as const;

export const EDITABLE_FIELDS: readonly EditableField[] = [
  { key: 'full_name', label: 'Full name' },
  { key: 'phone', label: 'Phone' },
  { key: 'house', label: 'House', options: HOUSES },
  { key: 'gender', label: 'Gender', options: GENDERS },
  { key: 'program', label: 'Program', options: PROGRAMS },
  { key: 'course_stage', label: 'Course stage', options: COURSE_STAGES },
  {
    key: 'mess_preference',
    label: 'Mess preference',
    hint: 'Only affects a future allocation — it does not move anybody already placed.',
  },
  { key: 'country', label: 'Country' },
  { key: 'state', label: 'State' },
  { key: 'city', label: 'City' },
  { key: 'address', label: 'Address', multiline: true },
];

/** The form's working copy: every editable field as a string. */
export type ParticipantForm = Record<string, string>;

/**
 * A record as the form should open on it.
 *
 * Missing values become `''` rather than staying undefined, so an input is
 * always controlled and a half-completed profile does not make React swap the
 * field between controlled and uncontrolled mid-edit.
 */
export function formFrom(participant: ParticipantRecord): ParticipantForm {
  const profile = participant.profile ?? {};
  const form: ParticipantForm = {};
  for (const field of EDITABLE_FIELDS) {
    const value = (profile as Record<string, unknown>)[field.key];
    const asString = typeof value === 'string' ? value : '';
    form[field.key] = field.key === 'house' ? bareHouse(asString) : asString;
  }
  return form;
}

/**
 * A dropdown's options, plus whatever the record already holds.
 *
 * A record storing `Male` where this file lists `male` is not corrected on
 * sight: silently rewriting a stored value while an admin was editing a
 * different field is a change nobody asked for, and it would show up in the
 * audit trail as theirs. The stored value is offered as an option instead.
 */
export function editableValue(field: EditableField, current: string): readonly string[] {
  if (!field.options) return [];
  if (!current || field.options.includes(current)) return field.options;
  return [current, ...field.options];
}

/**
 * Only what actually changed, as `PATCH /participants/{id}` wants it.
 *
 * Sending the whole form would work — the route `$set`s dotted keys, so nothing
 * would be blanked — but it would name every field in the audit trail on every
 * save, and `UPDATE_PARTICIPANT` recording eleven fields changed when one was is
 * a trail nobody can read. An empty result means there is nothing to send, which
 * is what disables the Save button.
 */
export function changedFields(
  original: ParticipantForm,
  edited: ParticipantForm,
): ParticipantAdminUpdateRequest {
  const patch: Record<string, string> = {};
  for (const field of EDITABLE_FIELDS) {
    const before = (original[field.key] ?? '').trim();
    const after = (edited[field.key] ?? '').trim();
    // An unchanged field is skipped, and so is clearing one: the backend drops
    // nulls and empty strings would overwrite a real value with nothing, which is
    // a deletion dressed up as an edit. Removing a value is not something this
    // form claims to do.
    if (after && after !== before) patch[field.key] = after;
  }
  return patch as ParticipantAdminUpdateRequest;
}

export function hasChanges(original: ParticipantForm, edited: ParticipantForm): boolean {
  return Object.keys(changedFields(original, edited)).length > 0;
}

/** "Cleared" fields, named so the form can say why Save ignored them. */
export function clearedFields(original: ParticipantForm, edited: ParticipantForm): EditableField[] {
  return EDITABLE_FIELDS.filter(
    (field) => (original[field.key] ?? '').trim() && !(edited[field.key] ?? '').trim(),
  );
}

/** Where a participant currently stands, for the roster's status column. */
export interface ParticipantStanding {
  profileComplete: boolean;
  hostel: string | null;
  mess: string | null;
  onCampus: boolean;
}

export function standingOf(participant: ParticipantRecord): ParticipantStanding {
  const profile = participant.profile ?? {};
  return {
    // A profile is `{}` from registration until `PATCH /profile/complete` fills
    // it, so `full_name` is what separates "signed up" from "ready" — the same
    // test `/participants/statistics` makes.
    profileComplete: Boolean(profile.full_name),
    hostel: participant.accommodation?.hostel_id ?? null,
    mess: participant.mess?.mess_id ?? null,
    onCampus: Boolean(participant.accommodation?.inside),
  };
}

/** "Meera Raghunathan" or, when there is no name on file, the id. */
export function displayName(participant: ParticipantRecord): string {
  return participant.profile?.full_name?.trim() || participant.participant_id;
}

/**
 * Block id to block name, from `GET /hostels`.
 *
 * `accommodation.hostel_id` is the only hostel field on a participant record —
 * `list_participants` returns the subdocument verbatim and never joins the
 * catalogue — so a roster that wants to say "Alakananda" rather than "HS01" has
 * to bring the catalogue with it. This is the same id-to-name lookup
 * `EntityLogsPage` and `HostelScannerPage` already do, kept here so the roster's
 * column stays a pure function of its two inputs.
 *
 * Blank names are dropped rather than mapped to `''`: a catalogue row saved
 * without a name should fall back to its id in `hostelLabel`, not render as
 * nothing.
 */
export function hostelNames(hostels: readonly Hostel[]): Record<string, string> {
  const names: Record<string, string> = {};
  for (const hostel of hostels) {
    if (hostel.hostel_id && hostel.name?.trim()) names[hostel.hostel_id] = hostel.name.trim();
  }
  return names;
}

/**
 * How the roster names somebody's stay: "Alakananda · 100".
 *
 * `null` means not allotted, which the column renders as its own state rather
 * than as an empty name.
 *
 * Falls back to the raw id when the catalogue has no row for it — an id is worse
 * to read than a name but it is still the truth, and it is what an admin can act
 * on. The alternative, hiding a placement because its block is missing from the
 * catalogue, would make an allotted participant look homeless. The room number
 * is appended unchanged, so a block whose name is unknown still shows the room.
 */
export function hostelLabel(
  participant: ParticipantRecord,
  names: Record<string, string>,
): string | null {
  const id = participant.accommodation?.hostel_id;
  if (!id) return null;
  const name = names[id] ?? id;
  const room = participant.accommodation?.room;
  return room ? `${name} · ${room}` : name;
}

/** "1 event", "2 events", "0 events" — plural on everything but exactly one. */
function counted(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? '' : 's'}`;
}

/**
 * How many things somebody has signed up for: "0 events · 1 workshop".
 *
 * This column used to read `0 ev · 1 ws`, which is compact and which nobody
 * could decode without being told what `ev` and `ws` stood for. The words are
 * wider but need no key.
 *
 * The counts are unchanged — `event_count` and `workshop_count` as
 * `GET /participants` computes them from the length of each array, so a cancelled
 * registration stops being counted. This is wording only.
 */
export function signupLabel(participant: ParticipantRecord): string {
  return `${counted(participant.event_count, 'event')} · ${counted(
    participant.workshop_count,
    'workshop',
  )}`;
}
