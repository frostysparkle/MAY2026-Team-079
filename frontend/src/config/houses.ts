/**
 * The twelve official IITM BS houses.
 *
 * `profile.house` is a free string the backend never validates, so this list is
 * the only thing keeping the values consistent — a typo here becomes a house
 * nobody else matches. Stored and sent exactly as written.
 *
 * Ordered alphabetically because that is how the profile dropdown reads; nothing
 * downstream depends on the order.
 */
export const HOUSES = [
  'Bandipur House',
  'Corbett House',
  'Gir House',
  'Kanha House',
  'Kaziranga House',
  'Nallamala House',
  'Namdapha House',
  'Nilgiri House',
  'Pichavaram House',
  'Saranda House',
  'Sundarbans House',
  'Wayanad House',
] as const;

export type House = (typeof HOUSES)[number];
