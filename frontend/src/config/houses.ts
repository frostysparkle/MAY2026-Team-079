/**
 * The twelve official IITM BS houses.
 *
 * `profile.house` **is** validated by the backend (`models.HOUSES`,
 * `ProfileCompleteRequest._valid_house`), against the bare names below — no
 * "House" suffix. Sending `"Bandipur House"` is a 422 ("house must be one of
 * [...]"), so the wire value has to be the bare name; only the on-screen label
 * may add the word back for readability. `HOUSE_OPTIONS` below is what every
 * dropdown should render from — it keeps the two forms of each name paired so
 * neither can drift out of step with the other.
 *
 * Ordered alphabetically because that is how the profile dropdown reads; nothing
 * downstream depends on the order.
 */
export const HOUSES = [
  'Bandipur',
  'Corbett',
  'Gir',
  'Kanha',
  'Kaziranga',
  'Nallamala',
  'Namdapha',
  'Nilgiri',
  'Pichavaram',
  'Saranda',
  'Sundarbans',
  'Wayanad',
] as const;

export type House = (typeof HOUSES)[number];

const HOUSE_LABEL_SUFFIX = ' House';

/** `Bandipur` → `{ value: 'Bandipur', label: 'Bandipur House' }`. The value is
 * what the backend accepts; the label is what a participant reads. */
export const HOUSE_OPTIONS = HOUSES.map((h) => ({
  value: h,
  label: `${h}${HOUSE_LABEL_SUFFIX}`,
}));

/**
 * The stored/wire form of a house name.
 *
 * The complete-profile dropdown shows "Bandipur House" because that is how
 * students know their house. The API stores the bare name. Older clients (and
 * a native `<select>` whose `value` attribute is missing) submit the label;
 * seeded rows in Atlas still hold the labelled form. Strip the suffix when it
 * maps onto a real house so the form value matches the dropdown and the PATCH
 * body matches `models.HOUSES`.
 */
export function bareHouse(value: string): string {
  if (value.endsWith(HOUSE_LABEL_SUFFIX)) {
    const bare = value.slice(0, -HOUSE_LABEL_SUFFIX.length);
    if ((HOUSES as readonly string[]).includes(bare)) return bare;
  }
  return value;
}
