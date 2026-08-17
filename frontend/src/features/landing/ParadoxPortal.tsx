import { useEffect, useState } from 'react';
import { AuroraBackdrop } from '@/components/ui';
import { ImpossibleTriangle } from '@/features/landing/ParadoxHeadline';
import { PublicMenu } from '@/features/landing/PublicMenu';
import { SocialRow } from '@/features/landing/SocialRow';
import { cn } from '@/lib/cn';

/**
 * Full-screen "portal" hero: a huge PARADOX title anchored dead-centre, with the
 * primary navigation spread around the edges of the viewport and the official
 * links along the bottom. It replaces the traditional top navbar for the landing
 * experience while staying keyboard- and screen-reader-friendly.
 *
 * Signed-in students get the Events and Workshops catalogue rendered below this
 * hero by `LandingPage`; signed out, the hero is the whole page.
 */

export type PortalNavItem = {
  label: string;
  /** In-page anchor (smooth scroll) OR a click handler for app/auth routes. */
  href?: string;
  onClick?: () => void;
};

/* ------------------------------------------------------------ helpers --- */

/** A single perimeter nav item — renders an anchor or a button as needed. */
function PortalLink({ item, className }: { item: PortalNavItem; className?: string }) {
  const base =
    'tap group inline-flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.18em] text-muted transition-colors hover:text-ink sm:text-[0.95rem]';
  const inner = (
    <>
      <span className="h-px w-0 bg-brand transition-all duration-300 group-hover:w-5" aria-hidden />
      {item.label}
    </>
  );
  if (item.href) {
    return (
      <a href={item.href} className={cn(base, className)}>
        {inner}
      </a>
    );
  }
  return (
    <button type="button" onClick={item.onClick} className={cn(base, className)}>
      {inner}
    </button>
  );
}

/* ------------------------------------------------------------- portal --- */

export function ParadoxPortal({
  nav,
  onRegister,
  onSignIn,
  authenticated = false,
  onOpenPass,
  onOpenProfile,
  onSignOut,
}: {
  nav: PortalNavItem[];
  onRegister: () => void;
  onSignIn: () => void;
  /** When true, the top bar shows My Pass + Profile instead of Login/Register. */
  authenticated?: boolean;
  onOpenPass?: () => void;
  onOpenProfile?: () => void;
  onSignOut?: () => void;
}) {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // Split the perimeter links so they can wrap around the centred title.
  const left = nav.filter((_, i) => i % 2 === 0);
  const right = nav.filter((_, i) => i % 2 === 1);

  return (
    <section
      id="top"
      className="relative flex min-h-[100dvh] flex-col overflow-x-hidden bg-canvas text-ink"
    >
      <AuroraBackdrop />
      <ImpossibleTriangle className="pointer-events-none absolute left-1/2 top-10 h-24 w-24 -translate-x-1/2 opacity-20 sm:h-32 sm:w-32" />

      {/* Top bar: brand + Register / Login */}
      <header
        className={cn(
          'relative z-20 transition-all duration-300',
          scrolled && 'glass border-b border-line/60',
        )}
      >
        <div
          className={cn(
            'relative grid w-full items-center gap-x-3 gap-y-3 px-4 py-5 sm:px-6',
            authenticated
              ? 'grid-cols-[minmax(0,1fr)_auto] sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]'
              : 'grid-cols-[minmax(0,1fr)_auto]',
          )}
        >
          <a href="#top" className="flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-2xl bg-gradient-to-br from-brand to-accent text-base font-black text-white shadow-fab">
              P
            </span>
            <span className="hidden truncate text-base font-black tracking-tight sm:inline">
              Paradox Connect
            </span>
          </a>

          {/* My Pass — pinned to the top-middle when signed in. */}
          {authenticated && (
            <button
              type="button"
              onClick={onOpenPass}
              className="tap order-3 col-span-2 mx-auto flex items-center gap-2 rounded-full bg-brand px-5 py-2 text-sm font-semibold uppercase tracking-[0.15em] text-white shadow-fab hover:bg-brand-dark active:scale-95 sm:order-none sm:col-span-1"
            >
              🎟 Digital Pass
            </button>
          )}

          {authenticated ? (
            <div className="flex items-center justify-self-end gap-1">
              <button
                type="button"
                onClick={onOpenProfile}
                className="tap rounded-full bg-surface-2 px-5 py-2 text-sm font-semibold uppercase tracking-[0.15em] text-ink hover:bg-surface active:scale-95"
              >
                Profile
              </button>
              <button
                type="button"
                onClick={onSignOut}
                className="tap rounded-full px-4 py-2 text-sm font-semibold uppercase tracking-[0.15em] text-muted hover:bg-surface-2 hover:text-danger"
              >
                Sign out
              </button>
              <PublicMenu className="ml-1" />
            </div>
          ) : (
            <div className="flex items-center justify-self-end gap-1">
              <button
                type="button"
                onClick={onSignIn}
                className="tap rounded-full px-4 py-2 text-sm font-semibold uppercase tracking-[0.15em] text-ink hover:bg-surface-2"
              >
                Login
              </button>
              <button
                type="button"
                onClick={onRegister}
                className="tap hidden rounded-full bg-brand px-5 py-2 text-sm font-semibold uppercase tracking-[0.15em] text-white shadow-fab hover:bg-brand-dark active:scale-95 sm:inline-flex"
              >
                Register
              </button>
              <PublicMenu className="ml-1" />
            </div>
          )}
        </div>
      </header>

      {/* Stage: perimeter nav wrapping a huge centred title */}
      <div className="relative z-10 flex flex-1 items-center justify-center px-4 py-10 sm:px-6">
        {/* Official links — centred along the bottom edge (desktop) */}
        <SocialRow className="absolute bottom-10 left-1/2 hidden -translate-x-1/2 gap-4 lg:flex" />

        <nav
          aria-label="Primary"
          className="grid w-full max-w-5xl grid-cols-1 items-center gap-8 md:grid-cols-[1fr_auto_1fr]"
        >
          {/* Left column links */}
          <ul className="order-2 flex flex-wrap justify-center gap-x-6 gap-y-3 md:order-1 md:flex-col md:items-end md:gap-4">
            {left.map((item) => (
              <li key={item.label}>
                <PortalLink item={item} />
              </li>
            ))}
          </ul>

          {/* Centre: the huge PARADOX title */}
          <div className="order-1 flex flex-col items-center text-center md:order-2">
            <p className="mb-3 text-xs font-semibold uppercase tracking-[0.35em] text-brand">
              IIT Madras
            </p>
            <h1 className="text-gradient text-6xl font-black leading-none tracking-tight sm:text-7xl lg:text-8xl xl:text-9xl">
              PARADOX
            </h1>
          </div>

          {/* Right column links */}
          <ul className="order-3 flex flex-wrap justify-center gap-x-6 gap-y-3 md:flex-col md:items-start md:gap-4">
            {right.map((item) => (
              <li key={item.label}>
                <PortalLink item={item} />
              </li>
            ))}
          </ul>
        </nav>

        {/* Official links — inline row on small screens */}
        <SocialRow className="absolute bottom-10 left-1/2 -translate-x-1/2 gap-4 lg:hidden" />
      </div>
    </section>
  );
}
