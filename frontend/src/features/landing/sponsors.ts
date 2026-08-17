/**
 * Sponsor roster for the public Sponsors page.
 *
 * ── Why `name` is nullable ────────────────────────────────────────────────────
 * The logo files under /images/sponsors are low-resolution crops, so the brand
 * names are not recoverable from the assets and are recorded nowhere else in
 * this repo. Rather than ship invented names — the page previously read
 * "Sponsor 1" … "Sponsor 8", "Stall Sponsor 1" … "Stall Sponsor 6", which
 * misattributes real companies and tells screen-reader users nothing — a sponsor
 * whose name is not yet confirmed carries `name: null`.
 *
 * `null` renders a neutral "Sponsor logo" alt text and no link. Filling in a
 * name (and optionally `href`) is the only change needed to complete an entry;
 * see NAMES_PENDING below for the outstanding list.
 */
export interface Sponsor {
  /** Asset path under /public. */
  src: string;
  /** Confirmed brand name, or null until the organisers supply it. */
  name: string | null;
  /** Official site. Only set alongside a confirmed `name`. */
  href?: string;
}

export interface SponsorGroup {
  title?: string;
  sponsors: Sponsor[];
}

export const SPONSOR_GROUPS: SponsorGroup[] = [
  {
    sponsors: [
      { src: '/images/sponsors/1.avif', name: null },
      { src: '/images/sponsors/2.avif', name: null },
      { src: '/images/sponsors/3.avif', name: null },
      { src: '/images/sponsors/4.avif', name: null },
      // `?v=2` busts the browser cache for logos that were replaced after
      // launch. Files in /public are not content-hashed by Vite, so the query
      // string is load-bearing — do not remove it.
      { src: '/images/sponsors/5.avif?v=2', name: null },
      { src: '/images/sponsors/6.avif', name: null },
      { src: '/images/sponsors/7.avif', name: null },
      { src: '/images/sponsors/9.avif', name: null },
    ],
  },
  {
    title: 'Event Sponsors',
    sponsors: [
      { src: '/images/sponsors/es1.avif', name: 'The5ers', href: 'https://the5ers.com/' },
      { src: '/images/sponsors/es2.avif', name: null },
      { src: '/images/sponsors/es3.avif', name: null },
      { src: '/images/sponsors/es4.avif?v=2', name: null },
    ],
  },
  {
    title: 'Stall Sponsors',
    sponsors: [
      { src: '/images/sponsors/ss1.avif', name: null },
      { src: '/images/sponsors/ss2.avif', name: null },
      { src: '/images/sponsors/ss3.avif', name: null },
      { src: '/images/sponsors/ss4.avif', name: null },
      { src: '/images/sponsors/ss5.avif', name: null },
      { src: '/images/sponsors/ss6.avif', name: null },
    ],
  },
];

/** Assets still waiting on a confirmed brand name from the organisers. */
export const NAMES_PENDING = SPONSOR_GROUPS.flatMap((group) =>
  group.sponsors.filter((sponsor) => sponsor.name === null).map((sponsor) => sponsor.src),
);

/** Alt text for a logo tile: the brand name, or a neutral, non-inventing label. */
export function sponsorAlt(sponsor: Sponsor): string {
  return sponsor.name ? `${sponsor.name} logo` : 'Sponsor logo';
}
