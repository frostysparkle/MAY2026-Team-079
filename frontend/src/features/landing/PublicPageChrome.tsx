import type { ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { LogOut, User } from 'lucide-react';
import { ROUTES } from '@/config/routes';
import { AuroraBackdrop } from '@/components/ui';
import { PublicMenu } from '@/features/landing/PublicMenu';
import { SocialRow } from '@/features/landing/SocialRow';
import { homeRoute, landingSections } from '@/features/landing/roleSections';
import { useAuthStore } from '@/stores/authStore';
import { cn } from '@/lib/cn';

/**
 * Shared chrome for the brochure pages — the branded "aurora" backdrop, the
 * Paradox Connect header, a left perimeter nav on desktop that collapses to a
 * wrapped row on phones, the official social handles, and a large gradient
 * title. Page content renders as children in the centred column.
 *
 * Keeps every brochure page (Events, Schedule, Workshops, Sponsors) visually
 * consistent from one source of truth.
 *
 * Signing in does not change any of that. It only changes the rail, which is
 * built from `landingSections` — so a signed-in reader sees their own sections
 * and a Home entry that returns to their Landing Page, in the identical layout a
 * visitor gets. The page itself is untouched by who is reading it.
 *
 * Adapted from the reference build: its "Digital Pass" modal is not ported
 * because that app issues rotating TOTP codes, whereas this one uses the
 * backend's RSA-OAEP encrypted QR payloads — signed-in users reach their pass
 * through the app shell at `/app/qr` instead.
 */

/* -------------------------------------------------------- side nav ------ */

type NavItem = { label: string; to?: string; onClick?: () => void };

function NavLink({ item, active }: { item: NavItem; active: boolean }) {
  const base = 'tap text-sm font-semibold uppercase tracking-[0.2em] transition-colors';
  const cls = active
    ? // brand-700 on brand-light: 6.83:1. `text-brand` here would be 4.26:1.
      cn(base, 'rounded-full bg-brand-light px-4 py-2 text-brand-700')
    : cn(base, 'px-4 py-2 text-muted hover:text-ink');

  if (active || (!item.to && !item.onClick)) {
    return (
      <span aria-current={active ? 'page' : undefined} className={cls}>
        {item.label}
      </span>
    );
  }
  if (item.to) {
    return (
      <Link to={item.to} className={cls}>
        {item.label}
      </Link>
    );
  }
  return (
    <button type="button" onClick={item.onClick} className={cls}>
      {item.label}
    </button>
  );
}

/* ----------------------------------------------------------- chrome ----- */

const MAX_W: Record<NonNullable<PublicPageChromeProps['width']>, string> = {
  md: 'max-w-3xl',
  lg: 'max-w-4xl',
  // The grid pages (events, workshops) are the ones that ask for `xl`, and they
  // have real content to put in the extra width — a fourth poster per row rather
  // than a wider margin.
  xl: 'max-w-7xl',
};

/**
 * Which rail entry is the current page. The rail is built from
 * `landingSections`, so the set of labels depends on who is signed in — a plain
 * string, matched by label, rather than a closed union that only describes the
 * signed-out list.
 */
export type PublicNavLabel = string;

export interface PublicPageChromeProps {
  /** Big gradient page title (e.g. "SCHEDULE"). Omit for a title-less layout
   *  (detail pages that render their own hero). */
  title?: string;
  /** Small eyebrow above the title. Defaults to "IIT Madras". */
  eyebrow?: string;
  /** Which perimeter nav item is the current page. */
  active?: PublicNavLabel;
  /** Centred column width. md=3xl, lg=4xl, xl=6xl. Defaults to lg. */
  width?: 'md' | 'lg' | 'xl';
  children: ReactNode;
}

export function PublicPageChrome({
  title,
  eyebrow = 'IIT Madras',
  active,
  width = 'lg',
  children,
}: PublicPageChromeProps) {
  const navigate = useNavigate();
  const session = useAuthStore((s) => s.session);
  const clear = useAuthStore((s) => s.clear);
  const authenticated = session !== null;

  // The same section list the Landing Page wraps around the wordmark, so a
  // signed-in visitor keeps their own sections here — and "Home" leads back to
  // *their* landing rather than the public one.
  const navItems: NavItem[] = landingSections(session);

  const appHome = homeRoute(session);

  return (
    <div className="relative min-h-full overflow-hidden bg-canvas text-ink">
      <AuroraBackdrop />

      <div className="safe-top safe-bottom relative z-10 flex min-h-full flex-col">
        <header className="relative grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-3 px-4 py-5 sm:px-6">
          <Link
            to={appHome}
            className="tap flex min-w-0 items-center gap-2"
            aria-label="Paradox Connect home"
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-brand to-accent text-base font-black text-white shadow-fab">
              P
            </span>
            <span className="hidden truncate text-base font-black tracking-tight sm:inline">
              Paradox Connect
            </span>
          </Link>

          {authenticated ? (
            <div className="flex items-center justify-self-end gap-2">
              <button
                type="button"
                onClick={() => navigate(appHome)}
                aria-label="Home"
                title="Home"
                className="tap flex h-10 w-10 items-center justify-center rounded-full bg-surface-2 text-ink shadow-card ring-1 ring-line hover:bg-surface active:scale-95"
              >
                <User size={18} strokeWidth={2} />
              </button>
              <button
                type="button"
                onClick={() => clear()}
                aria-label="Sign out"
                title="Sign out"
                className="tap flex h-10 w-10 items-center justify-center rounded-full bg-surface-2 text-muted shadow-card ring-1 ring-line hover:bg-surface hover:text-danger active:scale-95"
              >
                <LogOut size={18} strokeWidth={2} />
              </button>
              <PublicMenu />
            </div>
          ) : (
            <div className="flex items-center justify-self-end gap-1">
              <button
                type="button"
                onClick={() => navigate(ROUTES.login)}
                className="tap rounded-full px-4 py-2 text-sm font-semibold uppercase tracking-[0.15em] text-ink hover:bg-surface-2"
              >
                Login
              </button>
              <button
                type="button"
                onClick={() => navigate(ROUTES.login, { state: { mode: 'register' } })}
                className="tap hidden rounded-full bg-brand px-5 py-2 text-sm font-semibold uppercase tracking-[0.15em] text-white shadow-fab hover:bg-brand-dark active:scale-95 sm:inline-flex"
              >
                Register
              </button>
              <PublicMenu className="ml-1" />
            </div>
          )}
        </header>

        {/* Body — the gutter is reserved on the left only, because that is the
            only side anything sits in: the perimeter nav and social row are
            absolutely positioned there and ignore this padding. A matching
            gutter on the right used to mirror it, which cost ~240px of dead
            space in the right corner and squeezed the content column to under
            1000px on a 1440-wide window.

            The left figure is set by the social row (four 44px targets plus
            gaps ≈ 212px), not by the nav labels, so it cannot shrink much. */}
        <div className="relative flex-1 lg:pl-60 lg:pr-8 xl:pr-12">
          {/* Left perimeter rail (desktop): nav pinned to the top, social
              handles pushed to the bottom. One flex column spanning
              top-16 → bottom-8 so the two never overlap on short viewports. */}
          <div className="absolute bottom-8 left-4 top-16 z-20 hidden flex-col items-start gap-8 lg:flex xl:left-8">
            <nav aria-label="Sections" className="flex flex-col items-start gap-5">
              {navItems.map((item) => (
                <NavLink key={item.label} item={item} active={item.label === active} />
              ))}
            </nav>
            <SocialRow className="mt-auto" />
          </div>

          <main className={cn('mx-auto w-full px-4 pb-16 sm:px-6', MAX_W[width])}>
            {/* Section nav — horizontal on small screens */}
            <nav
              aria-label="Sections"
              className="mb-6 flex flex-wrap items-center justify-center gap-1 lg:hidden"
            >
              {navItems.map((item) => (
                <NavLink key={item.label} item={item} active={item.label === active} />
              ))}
            </nav>

            {title && (
              <div className="animate-rise flex flex-col items-center text-center">
                <p className="mb-2 text-xs font-semibold uppercase tracking-[0.35em] text-brand">
                  {eyebrow}
                </p>
                <h1 className="text-gradient text-6xl font-black uppercase leading-none tracking-tight sm:text-7xl">
                  {title}
                </h1>
              </div>
            )}

            {children}

            <SocialRow className="mt-10 justify-center lg:hidden" />
          </main>
        </div>
      </div>
    </div>
  );
}
