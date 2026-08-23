/**
 * App-wide constants matching the real backend contract
 * (see Frontend_Integration_Guide.md and backend/models.py).
 */

/** Participant registration is only accepted for these IITM email domains. */
export const IITM_EMAIL_DOMAINS = [
  '@ds.study.iitm.ac.in',
  '@es.study.iitm.ac.in',
  '@ee.study.iitm.ac.in',
  '@mg.study.iitm.ac.in',
] as const;

/** Mirrors the backend's `^[^@]+@[a-z]+\.study\.iitm\.ac\.in$` register check. */
export const IITM_EMAIL_PATTERN = /^[^@]+@[a-z]+\.study\.iitm\.ac\.in$/i;

/**
 * The regional cuisine axis of a mess hall's `type`. Mirrors the backend's
 * `MESS_CUISINES` (`backend/models.py`) — presentation only; nothing allocates
 * on it.
 */
export const MESS_CUISINES = ['north_indian', 'south_indian'] as const;
export type MessCuisine = (typeof MESS_CUISINES)[number];

const MESS_CUISINE_LABELS: Record<MessCuisine, string> = {
  north_indian: 'North Indian',
  south_indian: 'South Indian',
};

/** `north_indian` → "North Indian". Unknown values are shown as stored. */
export function messCuisineLabel(cuisine: string): string {
  return MESS_CUISINE_LABELS[cuisine as MessCuisine] ?? cuisine;
}

export const MESS_CUISINE_OPTIONS = MESS_CUISINES.map((value) => ({
  value,
  label: MESS_CUISINE_LABELS[value],
}));

/** The dietary axis of a mess hall's `type`. Mirrors the backend's `MESS_DIETS`. */
export const MESS_DIETS = ['veg', 'non_veg'] as const;
export type MessDiet = (typeof MESS_DIETS)[number];

/**
 * The real, closed vocabulary for both a mess hall's `type`
 * (`MessCreateRequest.type`) and a participant's `mess_preference`
 * (`ProfileCompleteRequest.mess_preference`) — the backend validates both
 * against the exact same set on purpose (`backend/models.py`'s
 * `MESS_PREFERENCE_TYPES`: `"{cuisine}__{diet}"` for every cuisine × diet pair,
 * plus a standalone `"jain"`), so a hall's declared type and a participant's
 * stated preference can never disagree about what counts as a valid value.
 *
 * This replaces the old, narrower `veg | non_veg | jain` list that both the
 * hall-creation form and the meal-preference picker used to offer: neither of
 * those three bare values (other than `jain`) is in the backend's real set, so
 * submitting one 422s.
 */
export const MESS_PREFERENCE_TYPES = [
  'north_indian__veg',
  'north_indian__non_veg',
  'south_indian__veg',
  'south_indian__non_veg',
  'jain',
] as const;
export type MessPreferenceType = (typeof MESS_PREFERENCE_TYPES)[number];

/** `north_indian__veg` → "Veg · North Indian". `jain` → "Jain". */
export function messPreferenceTypeLabel(type: string): string {
  if (type === 'jain') return 'Jain';
  const [cuisine, diet] = type.split('__');
  const cuisineLabel = messCuisineLabel(cuisine);
  const dietLabel = diet === 'non_veg' ? 'Non-Veg' : diet === 'veg' ? 'Veg' : diet;
  return cuisine && diet ? `${dietLabel} · ${cuisineLabel}` : type;
}

export const MESS_PREFERENCE_TYPE_OPTIONS = MESS_PREFERENCE_TYPES.map((value) => ({
  value,
  label: messPreferenceTypeLabel(value),
}));

/**
 * The dietary axis of a combined `type`, e.g. `"north_indian__veg"` → `"veg"`,
 * `"jain"` → `"jain"`. Mirrors the backend's own `_diet_of` (`routers/mess.py`)
 * exactly, so a value read here and one computed by the allocator never
 * disagree about which diet a `type` represents.
 */
export function messDietOf(type: string): string {
  if (type === 'jain') return 'jain';
  const parts = type.split('__');
  return parts[parts.length - 1];
}

/** The cuisine axis of a combined `type`, or `null` for `jain` (no region). */
export function messCuisineOf(type: string): MessCuisine | null {
  if (type === 'jain') return null;
  const [cuisine] = type.split('__');
  return (MESS_CUISINES as readonly string[]).includes(cuisine) ? (cuisine as MessCuisine) : null;
}
/**
 * Gender values a participant can record on their profile.
 *
 * A strict binary, matching the backend's own closed set (`models.GENDERS`,
 * `ProfileCompleteRequest._valid_gender`) — there is no "other" bucket there,
 * so offering one here would let a participant pick a value that 422s on save.
 *
 * Hostel auto-allocation buckets hostels by their `gender` and then looks up the
 * participant's own value (`routers/hostels.py`:
 * `gender_groups.get(gender, [])`), so these values have to be exactly the ones
 * hostels are labelled with.
 */
export const GENDERS = ['male', 'female'] as const;
export type Gender = (typeof GENDERS)[number];
/**
 * What a hostel block can be. Accommodation is men's or women's — there is no
 * mixed block — so this is deliberately narrower than `GENDERS`.
 */
export const HOSTEL_GENDERS = ['male', 'female'] as const;
export type HostelGender = (typeof HOSTEL_GENDERS)[number];
/** `male` → "Male", for dropdowns. */
function genderOptions(values: readonly string[]) {
  return values.map((g) => ({ value: g, label: g[0].toUpperCase() + g.slice(1) }));
}
export const GENDER_OPTIONS = genderOptions(GENDERS);
export const HOSTEL_GENDER_OPTIONS = genderOptions(HOSTEL_GENDERS);

/** Program codes — backend stores these as a free string (models.py comment: DS|ES|AE|MS). */
export const PROGRAMS = ['DS', 'ES', 'AE', 'MS'] as const;

/** Course stage — backend stores as a free string. */
export const COURSE_STAGES = ['foundational', 'diploma', 'degree'] as const;

/** Profile photo upload constraints (frontend-only choice, backend just stores the string). */
export const PHOTO = {
  maxBytes: 750 * 1024, // 750 KB
  acceptedTypes: ['image/jpeg', 'image/png'] as const,
  acceptAttr: 'image/jpeg,image/png',
};
