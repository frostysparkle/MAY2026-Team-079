import type { ParticipantLoginResponse } from '@/api/types';
import { messPreferenceTypeLabel } from '@/config/constants';

/**
 * How a stored profile value is written out on the read-only Profile screen.
 *
 * The backend stores these as free strings and the complete-profile form writes
 * the machine values (`non_veg`, `foundational`, `male`), so something has to
 * turn them back into English. That job lives here rather than in the page so
 * the page stays layout, and so an unrecognised value has exactly one defined
 * behaviour: **shown as stored**. A profile written by an older client, or by
 * hand, must never render as blank or as a guess — a value that is really there
 * and a value that was never filled in are different answers.
 */

/** `foundational` → "Foundational", `north indian` → "North indian". */
function titleCase(value: string): string {
  const trimmed = value.trim();
  return trimmed ? trimmed[0].toUpperCase() + trimmed.slice(1) : trimmed;
}

/** `male` → "Male". Anything else is shown as stored. */
export function genderLabel(gender: string | null | undefined): string | null {
  return gender ? titleCase(gender) : null;
}

/** `foundational` → "Foundational". Anything else is shown as stored. */
export function courseStageLabel(stage: string | null | undefined): string | null {
  return stage ? titleCase(stage) : null;
}

/**
 * `north_indian__veg` → "North Indian · Veg", `jain` → "Jain". Matches the
 * closed set `PATCH /profile/complete` and `POST /mess` both validate
 * `mess_preference`/`type` against (`config/constants.ts`'s
 * `MESS_PREFERENCE_TYPES`). Anything outside that set is shown as stored — a
 * profile carrying a value the current vocabulary does not recognise has to
 * stay visible rather than be tidied away.
 */
export function messPreferenceLabel(preference: string | null | undefined): string | null {
  if (!preference) return null;
  return messPreferenceTypeLabel(preference);
}

/**
 * "2003-05-14" → "14 May 2003".
 *
 * Split by hand rather than parsed with `new Date(dob)`, which reads a bare
 * date as UTC midnight and so renders the day before anywhere west of
 * Greenwich. Anything that is not a plain `YYYY-MM-DD` is shown as stored.
 */
export function formatDob(dob: string | null | undefined): string | null {
  if (!dob) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dob.trim());
  if (!match) return dob;
  const [, year, month, day] = match;
  const date = new Date(Number(year), Number(month) - 1, Number(day));
  if (Number.isNaN(date.getTime())) return dob;
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
}

/**
 * The fields the complete-profile form collects, in the order it asks for them,
 * with the label the Profile screen shows for each.
 *
 * `mess_preference` and `emergency_contact` are deliberately **not** here.
 * `/auth/login` does not return either one (see `ParticipantLoginResponse`), so
 * a freshly signed-in participant whose profile is entirely complete would be
 * told two details are missing. A completeness figure that is wrong for
 * everyone who just signed in is worse than a completeness figure over twelve
 * fields instead of fourteen.
 */
const TRACKED_FIELDS: ReadonlyArray<{
  key: keyof ParticipantLoginResponse;
  label: string;
}> = [
  { key: 'full_name', label: 'Full name' },
  { key: 'photo', label: 'Photo' },
  { key: 'dob', label: 'Date of birth' },
  { key: 'gender', label: 'Gender' },
  { key: 'phone', label: 'Phone' },
  { key: 'house', label: 'House' },
  { key: 'program', label: 'Program' },
  { key: 'course_stage', label: 'Course stage' },
  { key: 'country', label: 'Country' },
  { key: 'state', label: 'State' },
  { key: 'city', label: 'City' },
  { key: 'address', label: 'Address' },
];

export interface ProfileCompletion {
  filled: number;
  total: number;
  /** 0–100, rounded. */
  percent: number;
  /** Labels of the fields still to fill in, in form order. */
  missing: string[];
}

/** How much of the profile has actually been filled in. */
export function profileCompletion(participant: ParticipantLoginResponse): ProfileCompletion {
  const missing = TRACKED_FIELDS.filter(({ key }) => {
    const value = participant[key];
    return typeof value !== 'string' || value.trim() === '';
  }).map(({ label }) => label);

  const total = TRACKED_FIELDS.length;
  const filled = total - missing.length;
  return { filled, total, percent: Math.round((filled / total) * 100), missing };
}
