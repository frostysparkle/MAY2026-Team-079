/**
 * Official Paradox links, in one place.
 *
 * Previously the landing hero and the public page chrome each carried their own
 * copy of this list, and both pointed at bare domains (`https://instagram.com`,
 * `https://youtube.com`, `https://facebook.com`) — placeholder hrefs that sent
 * visitors to a generic feed instead of the fest.
 *
 * Rule for this file: only add an entry whose destination has been confirmed.
 * An unverified handle is worse than an absent icon, because a wrong link looks
 * deliberate. Entries listed in PENDING below are intentionally not rendered.
 */
export interface SocialLink {
  /** Accessible name and tooltip. */
  label: string;
  href: string;
  /** Which icon to draw. Keep in sync with the `SOCIAL_ICONS` map. */
  icon: 'instagram' | 'youtube' | 'linkedin' | 'globe';
}

export const SOCIAL_LINKS: SocialLink[] = [
  {
    label: 'Paradox on Instagram',
    href: 'https://www.instagram.com/paradox.iitm/',
    icon: 'instagram',
  },
  {
    label: 'Paradox on YouTube',
    href: 'https://www.youtube.com/@paradox_iitmadras',
    icon: 'youtube',
  },
  {
    label: 'Paradox on LinkedIn',
    href: 'https://in.linkedin.com/company/paradox-iitmadras',
    icon: 'linkedin',
  },
  {
    label: 'Official Paradox website',
    href: 'https://www.iitmparadox.org/',
    icon: 'globe',
  },
];

/**
 * Channels the fest is known to run but whose exact handle is not confirmed in
 * this repo. Add them to SOCIAL_LINKS (and SOCIAL_ICONS) once the organisers
 * supply the URL — do not guess:
 *   - X/Twitter (a profile exists; handle unknown)
 *   - Facebook  (no evidence a page exists)
 */
export const PENDING_SOCIAL_CHANNELS = ['X', 'Facebook'] as const;

/** Support address published by the Paradox organisers. */
export const SUPPORT_EMAIL = 'support@iitmparadox.org';
