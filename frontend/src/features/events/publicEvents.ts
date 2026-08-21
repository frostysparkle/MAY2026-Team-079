/**
 * The three public event categories — Sports, Culturals, and Technicals — and
 * the artwork and copy that dress them.
 *
 * This file holds *presentation only*. No event lives here: the programme comes
 * from the API (`GET /events/public`), so every event is one a Super Admin
 * created in the dashboard. A category is the frame; the events inside it are
 * data.
 *
 * The slugs are part of the public URL (`/events/<category>/<eventId>`), so they
 * are stable, and they map onto the backend's `event_type` vocabulary in
 * `eventView.ts`.
 */

export type PublicEventCategorySlug = 'sports' | 'culturals' | 'technicals';

export interface PublicEventCategory {
  slug: PublicEventCategorySlug;
  label: string;
  icon: string;
  /** Tailwind gradient tint used as an accent. */
  tint: string;
  /** Accent colour matching the category card's frame (Sports=red, etc.). */
  accent: string;
  /** Deep themed background for the category section page (reference look). */
  darkBg: string;
  /** Portrait category card artwork (title baked in) from the reference site. */
  card: string;
  /**
   * Landscape category cover image. Doubles as the poster an event falls back to
   * when it has none of its own, and as the `onError` source for a poster URL
   * that fails to load.
   */
  image: string;
}

export const PUBLIC_EVENT_CATEGORIES: PublicEventCategory[] = [
  {
    slug: 'sports',
    label: 'Sports',
    icon: '🏅',
    tint: 'from-emerald-400/25 to-emerald-400/5',
    accent: '#9E2A2B',
    darkBg: '#2b0b0d',
    card: '/images/events/Sports-Card.avif',
    image: '/images/events/Sports.avif',
  },
  {
    slug: 'culturals',
    label: 'Culturals',
    icon: '🎭',
    tint: 'from-violet-400/25 to-violet-400/5',
    accent: '#6D28D9',
    darkBg: '#191140',
    card: '/images/events/Culturals-Card.avif',
    image: '/images/events/Culturals.avif',
  },
  {
    slug: 'technicals',
    label: 'Technicals',
    icon: '⚙️',
    tint: 'from-sky-400/25 to-sky-400/5',
    accent: '#C2410C',
    darkBg: '#2b1206',
    card: '/images/events/Technicals-Card.avif',
    image: '/images/events/Technicals.avif',
  },
];

export function getPublicEventCategory(slug: string | undefined): PublicEventCategory | undefined {
  return PUBLIC_EVENT_CATEGORIES.find((c) => c.slug === slug);
}
