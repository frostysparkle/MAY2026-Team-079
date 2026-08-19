/**
 * The overview board's categorical encoding: one locked hue per fest domain.
 *
 * These names map to the `--color-domain-*` tokens in `index.css`, where the
 * validation rationale lives. Charts take a `Domain` rather than a colour so a
 * panel can never accidentally paint itself in another domain's hue, and so a
 * future re-step of the palette happens in one place.
 *
 * Six hues clear separation on *adjacent* pairs, not on all pairs — indigo and
 * sky, olive and amber get close when compared directly. So domain colour is an
 * identity mark at panel level (a rail, a chip, a single-series chart), never
 * six series inside one chart. The one all-six mark on the board, the reach
 * breakdown in the Participants panel, is drawn in `DOMAIN_ORDER` — the exact
 * order the palette was validated in — and direct-labels every segment.
 */

export type Domain = 'hostels' | 'mess' | 'workshops' | 'events' | 'staff' | 'people';

/** The validated adjacency order. Never reorder without re-validating. */
export const DOMAIN_ORDER: Domain[] = ['hostels', 'mess', 'workshops', 'events', 'staff', 'people'];

/** CSS colour value per domain, for SVG `fill` / `stroke`. */
export const DOMAIN_COLOR: Record<Domain, string> = {
  hostels: 'var(--color-domain-hostels)',
  mess: 'var(--color-domain-mess)',
  workshops: 'var(--color-domain-workshops)',
  events: 'var(--color-domain-events)',
  staff: 'var(--color-domain-staff)',
  people: 'var(--color-domain-people)',
};

export const DOMAIN_LABEL: Record<Domain, string> = {
  hostels: 'Hostels',
  mess: 'Mess',
  workshops: 'Workshops',
  events: 'Events',
  staff: 'Staff',
  people: 'Participants',
};

/**
 * A single-hue ramp for magnitude, light → dark, used by the meal heatmap.
 * One hue, monotonic lightness — never a rainbow, which would encode order the
 * eye cannot rank.
 */
export const MAGNITUDE_RAMP = [
  '#eef2ff',
  '#c7d2fe',
  '#a5b4fc',
  '#818cf8',
  '#6366f1',
  '#4f46e5',
  '#3730a3',
];

/** Pick a ramp step for `value` against `max`. `max <= 0` yields the lightest. */
export function rampStep(value: number, max: number): string {
  if (!Number.isFinite(value) || !Number.isFinite(max) || max <= 0 || value <= 0) {
    return MAGNITUDE_RAMP[0];
  }
  const index = Math.min(
    MAGNITUDE_RAMP.length - 1,
    Math.round((value / max) * (MAGNITUDE_RAMP.length - 1)),
  );
  return MAGNITUDE_RAMP[index];
}

/** Ramp steps 4 and up are dark enough to carry white text. */
export function rampInkOn(value: number, max: number): string {
  const step = MAGNITUDE_RAMP.indexOf(rampStep(value, max));
  return step >= 4 ? '#ffffff' : 'var(--color-ink)';
}
