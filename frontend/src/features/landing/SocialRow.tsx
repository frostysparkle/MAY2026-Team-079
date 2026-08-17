import type { ReactElement } from 'react';
import { cn } from '@/lib/cn';
import { SOCIAL_LINKS, type SocialLink } from './socialLinks';

/**
 * The official-links row shared by the landing hero and the public page chrome.
 * Both files used to carry their own copy of the icons and the link list; this
 * is the single implementation.
 */

function InstagramIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden className={className}>
      <rect x="3" y="3" width="18" height="18" rx="5" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="17.5" cy="6.5" r="1.2" fill="currentColor" />
    </svg>
  );
}

function YoutubeIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden className={className}>
      <rect x="2.5" y="5.5" width="19" height="13" rx="4" stroke="currentColor" strokeWidth="1.8" />
      <path d="M10 9.5v5l4.5-2.5L10 9.5Z" fill="currentColor" />
    </svg>
  );
}

function LinkedInIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden className={className}>
      <rect x="3" y="3" width="18" height="18" rx="4" stroke="currentColor" strokeWidth="1.8" />
      <path d="M7.5 10.5V17" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="7.5" cy="7.4" r="1.1" fill="currentColor" />
      <path
        d="M11.5 17v-3.6a2.4 2.4 0 0 1 4.8 0V17"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function GlobeIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden className={className}>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.8" />
      <path d="M3.2 9.5h17.6M3.2 14.5h17.6" stroke="currentColor" strokeWidth="1.8" />
      <path
        d="M12 3c2.4 2.4 3.6 5.4 3.6 9S14.4 18.6 12 21c-2.4-2.4-3.6-5.4-3.6-9S9.6 5.4 12 3Z"
        stroke="currentColor"
        strokeWidth="1.8"
      />
    </svg>
  );
}

const SOCIAL_ICONS: Record<SocialLink['icon'], (p: { className?: string }) => ReactElement> = {
  instagram: InstagramIcon,
  youtube: YoutubeIcon,
  linkedin: LinkedInIcon,
  globe: GlobeIcon,
};

export function SocialRow({ className }: { className?: string }) {
  return (
    <nav aria-label="Official Paradox links" className={cn('flex items-center gap-3', className)}>
      {SOCIAL_LINKS.map((link) => {
        const Icon = SOCIAL_ICONS[link.icon];
        return (
          <a
            key={link.href}
            href={link.href}
            target="_blank"
            rel="noreferrer noopener"
            aria-label={link.label}
            title={link.label}
            className="group flex h-11 w-11 items-center justify-center rounded-full"
          >
            {/* Inner element does the lifting; the anchor's box stays put so the
                hover boundary can't slide off the cursor. */}
            <span className="tap flex h-full w-full items-center justify-center rounded-full border border-line/70 bg-surface/70 text-muted backdrop-blur transition-all group-hover:-translate-y-0.5 group-hover:border-brand group-hover:text-brand">
              <Icon className="h-5 w-5" />
            </span>
          </a>
        );
      })}
    </nav>
  );
}
