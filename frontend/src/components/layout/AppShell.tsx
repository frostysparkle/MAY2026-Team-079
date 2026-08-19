import { Link, NavLink, Outlet } from 'react-router-dom';
import { LogOut } from 'lucide-react';
import { ROUTES } from '@/config/routes';
import { useAuthStore, currentParticipant } from '@/stores/authStore';
import { AuroraBackdrop } from '@/components/ui';
import { cn } from '@/lib/cn';

/**
 * Participant navigation. Rendered as a persistent left rail from `lg` up, and as
 * a horizontal scroller under the header below that — same links, same order, one
 * source of truth.
 *
 * Deliberately the same list shape as `StaffShell`'s: Dashboard first, then one
 * entry per section. There is no separate phone list, because a link that only
 * exists on one viewport is a link the other one can never be told about.
 */
const NAV: { to: string; label: string }[] = [
  { to: ROUTES.home, label: 'Dashboard' },
  { to: ROUTES.events, label: 'Events' },
  { to: ROUTES.workshops, label: 'Workshops' },
  { to: ROUTES.schedule, label: 'Schedule' },
  { to: ROUTES.accommodation, label: 'Stay' },
  { to: ROUTES.myQr, label: 'My QR' },
  { to: ROUTES.profile, label: 'Profile' },
];

/**
 * The public brochure's perimeter-nav vocabulary, reused verbatim so the
 * participant rail, the staff rail, and the `/events` rail all read as one site:
 * uppercase, wide tracking, no panel behind it, and a brand-light pill on the
 * current section.
 *
 * Kept identical to `StaffShell` and to `NavLink` in
 * `features/landing/PublicPageChrome.tsx` — `text-brand-700` on `bg-brand-light`
 * is 6.83:1, where plain `text-brand` would only be 4.26:1.
 */
const NAV_BASE = 'tap text-sm font-semibold uppercase tracking-[0.2em] transition-colors';
const NAV_ACTIVE = 'rounded-full bg-brand-light px-4 py-2 text-brand-700';
const NAV_IDLE = 'px-4 py-2 text-muted hover:text-ink';

/**
 * Layout route for every participant screen — the mirror of `StaffShell`.
 *
 * It used to be a different kind of layout altogether: a bordered rail panel with
 * icon rows, a fixed bottom tab bar, and a `max-w-md` phone column that every
 * page then padded itself inside. That made the participant area read as a
 * separate product from the dashboard that administers it. The two now share the
 * same backdrop, the same nav vocabulary, and the same content column, so a
 * screen moved between them would not need restyling.
 *
 * The header is deliberately thin and transparent: every page renders its own
 * title through `FestivalScreen`, so the shell contributes navigation and the
 * backdrop, never a competing title bar. Clearing the session is enough to sign
 * out — `ProtectedRoute` owns the redirect.
 */
export function AppShell() {
  const clear = useAuthStore((s) => s.clear);
  const participant = currentParticipant();
  const who = participant?.full_name || participant?.email;

  return (
    <div className="relative flex min-h-full bg-canvas">
      {/* One backdrop behind the whole shell, as `StaffShell` and
          `PublicPageChrome` do. The rail has no panel of its own, so it needs
          this ground to sit on. It clips itself, so no `overflow-hidden` here
          that would break the sticky rail. */}
      <AuroraBackdrop />

      {/* Desktop rail — panel-less and floating over the backdrop, exactly like
          the perimeter nav on the public brochure pages. */}
      <aside className="sticky top-0 z-20 hidden h-[100dvh] w-60 shrink-0 flex-col px-4 py-5 lg:flex xl:w-64">
        {/* Drops the first nav item to roughly the baseline the public rail sits
            at (it starts `top-16` under the brochure header). */}
        <Link to={ROUTES.splash} className="tap mb-24 flex items-center gap-2">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-brand to-accent text-base font-black text-white shadow-fab">
            P
          </span>
          <span className="truncate text-base font-black tracking-tight text-ink">
            Paradox Connect
          </span>
        </Link>

        <nav aria-label="Participant sections" className="flex flex-col items-start gap-5">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              // Only the dashboard needs it: it is the parent path of every other
              // link, so without `end` it would stay lit on all of them.
              end={item.to === ROUTES.home}
              className={({ isActive }) => cn(NAV_BASE, isActive ? NAV_ACTIVE : NAV_IDLE)}
            >
              {item.label}
            </NavLink>
          ))}
        </nav>

        {/* Where the public rail pins its social row, this pins the session. */}
        <div className="mt-auto flex flex-col items-start gap-1">
          {who && (
            <p className="max-w-full truncate px-4 text-xs text-muted" title={who}>
              {who}
            </p>
          )}
          <button
            type="button"
            onClick={() => clear()}
            className={cn(NAV_BASE, 'px-4 py-2 text-muted hover:text-danger')}
          >
            Sign out
          </button>
        </div>
      </aside>

      {/* Content column */}
      <div className="relative z-10 flex min-w-0 flex-1 flex-col">
        <header className="safe-top sticky top-0 z-40 border-b border-transparent">
          {/* Mobile-only brand + sign out; the rail owns these on desktop. */}
          <div className="flex items-center justify-between px-4 py-3 lg:hidden">
            <div className="min-w-0">
              <p className="text-sm font-bold tracking-tight text-brand">Paradox Connect</p>
              {who && <p className="truncate text-xs text-muted">{who}</p>}
            </div>
            <button
              type="button"
              onClick={() => clear()}
              className="tap flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-muted hover:bg-surface-2 hover:text-danger"
            >
              <LogOut size={14} strokeWidth={2.25} />
              Sign out
            </button>
          </div>

          {/* Mobile section nav. Same pill vocabulary as the rail, but kept on one
              scrolling line: six wide-tracked labels wrap to three rows on a
              phone, which would push the page content off-screen. */}
          <nav
            aria-label="Participant sections"
            className="no-scrollbar flex gap-1 overflow-x-auto border-t border-line/60 px-3 py-2 lg:hidden"
          >
            {NAV.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === ROUTES.home}
                className={({ isActive }) =>
                  cn(
                    'tap shrink-0 whitespace-nowrap text-xs font-semibold uppercase tracking-[0.16em] transition-colors',
                    isActive
                      ? 'rounded-full bg-brand-light px-3 py-1.5 text-brand-700'
                      : 'px-3 py-1.5 text-muted hover:text-ink',
                  )
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
        </header>

        <main className="relative flex-1">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
