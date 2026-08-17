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
 * Mess-preference options. The backend's allocation logic groups by these
 * exact values (see routers/mess.py) — do not offer free-text or the stale
 * "South Indian"-style values `ProfileCompleteRequest`'s docstring suggests,
 * or auto-allocation will silently match nothing.
 */
export const MESS_PREFERENCES = ['veg', 'non_veg', 'jain'] as const;
export type MessPreference = (typeof MESS_PREFERENCES)[number];

/**
 * What a mess hall cooks. A separate axis from `preference`: a hall is veg or
 * non-veg or jain *and* serves one or both regional menus, so this is a list
 * rather than a fourth preference value — Nilgiri serves both.
 *
 * Nothing allocates on cuisine. `POST /mess/allocate` groups by `preference`
 * alone, so adding a cuisine here changes what the dashboard shows, never who
 * gets placed where.
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
/**
 * Gender values a participant can record on their profile.
 *
 * Hostel auto-allocation buckets hostels by their `gender` and then looks up the
 * participant's own value (`routers/hostels.py`:
 * `gender_groups.get(gender, [])`), so these values have to be exactly the ones
 * hostels are labelled with — the old free-text "any" formed a bucket nothing
 * ever matched, and such a hostel was never allocated to.
 */
export const GENDERS = ['male', 'female', 'other'] as const;
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
