import { useState } from 'react';
import { PublicPageChrome } from '@/features/landing/PublicPageChrome';
import { SPONSOR_GROUPS, sponsorAlt, type Sponsor } from '@/features/landing/sponsors';

/**
 * Public, pre-login Sponsors page — rendered inside the shared public chrome
 * (branded light backdrop + header + perimeter nav). Clean white logo tiles
 * grouped into Sponsors, Event Sponsors, and Stall Sponsors. The roster itself
 * lives in `features/landing/sponsors.ts`.
 */
export default function PublicSponsorsPage() {
  return (
    <PublicPageChrome title="Sponsors" active="Sponsors" width="lg">
      <div className="mt-10 flex flex-col gap-12 pb-4">
        {SPONSOR_GROUPS.map((group, groupIndex) => (
          <section key={group.title ?? `group-${groupIndex}`}>
            {group.title && (
              <div className="mb-6 flex items-center gap-3">
                <span className="h-px flex-1 bg-line" aria-hidden />
                <h2 className="text-xl font-black uppercase tracking-[0.16em] text-ink sm:text-2xl">
                  {group.title}
                </h2>
                <span className="h-px flex-1 bg-line" aria-hidden />
              </div>
            )}

            <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 sm:gap-6 lg:grid-cols-4">
              {group.sponsors.map((sponsor) => (
                <li key={sponsor.src}>
                  <LogoTile sponsor={sponsor} />
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </PublicPageChrome>
  );
}

function LogoTile({ sponsor }: { sponsor: Sponsor }) {
  // A missing asset previously left a blank white tile with no explanation; the
  // sibling catalogue pages already guard against this with an onError fallback.
  const [failed, setFailed] = useState(false);
  const alt = sponsorAlt(sponsor);

  // The outer wrapper stays untransformed and owns `:hover`; the inner tile does
  // the lifting. Animating the hover target itself makes it slide out from under
  // the cursor near an edge and oscillate — see components/ui/Card.tsx.
  const tile = (
    <div className="tap flex aspect-[3/2] w-full items-center justify-center rounded-2xl bg-surface p-5 shadow-card ring-1 ring-line/70 transition-all duration-300 group-hover:-translate-y-1 group-hover:shadow-lift">
      {failed ? (
        <span className="text-center text-xs font-semibold text-muted">
          {sponsor.name ?? 'Sponsor'}
        </span>
      ) : (
        <img
          src={sponsor.src}
          alt={alt}
          loading="lazy"
          decoding="async"
          onError={() => setFailed(true)}
          className="max-h-full max-w-full object-contain"
        />
      )}
    </div>
  );

  // Only a confirmed sponsor gets a link — an unnamed logo has no verified site.
  if (sponsor.href && sponsor.name) {
    return (
      <a
        href={sponsor.href}
        target="_blank"
        rel="noreferrer noopener"
        aria-label={`${sponsor.name} — opens in a new tab`}
        className="group block rounded-2xl"
      >
        {tile}
      </a>
    );
  }
  return <div className="group rounded-2xl">{tile}</div>;
}
