import { Link, NavLink, Outlet } from 'react-router-dom';
import { LogOut } from 'lucide-react';
import { ROUTES } from '@/config/routes';
import { useAuthStore, currentStaff, isSuperAdmin } from '@/stores/authStore';
import { AuroraBackdrop } from '@/components/ui';
import { cn } from '@/lib/cn';

/**
 * Staff navigation. Rendered as a persistent left rail from `lg` up, and as a
 * horizontal scroller under the header below that — same links, same order, one
 * source of truth.
 *
 * Home comes first for everyone and leads out of this shell, back to the Landing
 * Page at `/staff` — the PARADOX portal with this staffer's sections around it.
 * That is the way back from every screen in here, so the rail and the landing
 * offer the same sections in the same order.
 *
 * `staffDuties` is marked `hideForSuperAdmin` rather than removed. It is a
 * *personal* duty list — the halls, blocks, and events whose teams name you — so
 * for a volunteer or an event head it is the only page that matters, and four
 * scanner screens link back to it. A Super Admin is on none of those teams, which
 * left them a nav entry to a page whose only populated section was a list of
 * every event linking to its participation report. That is already reachable
 * three other ways: the Events panel on this board, the row menu on Admin Events,
 * and each event's own detail screen. So the route stays and the entry goes, and
 * Overview — the fest-wide board — becomes their first section instead.
 */
const NAV: {
  to: string;
  label: string;
  superAdmin?: boolean;
  /** Present for other staff, redundant for a Super Admin. */
  hideForSuperAdmin?: boolean;
}[] = [
  { to: ROUTES.staffHome, label: 'Home' },
  // "Dashboard", not "Duties". The screen behind it has been titled `Dashboard`
  // since it was written (`StaffHomePage`'s `FestivalScreen`), so the rail, the
  // landing, and the six back buttons that lead here were all naming it something
  // its own heading disagreed with. The route id stays `staffDuties`: renaming the
  // path would break links that are live in the overview board and on bookmarks.
  { to: ROUTES.staffDuties, label: 'Dashboard', hideForSuperAdmin: true },
  // Story 5.4 and Stories 6.3/6.4, in one section and deliberately unflagged:
  // `GET /queries` and `GET /issues` both scope themselves to the caller's own
  // teams — events, workshops, blocks and halls for the first, blocks and halls
  // for the second — and both hand a Super Admin the whole fest. So this is one
  // screen both roles want, unlike the admin sections below it.
  //
  // It was two entries, Issues and Queries, sitting next to each other under a
  // comment observing that they were the same shift. They were, and a volunteer
  // still had to open both to learn that nothing was waiting on them. Now one
  // section carries both queues as tabs with a shared row of figures, and the two
  // old paths redirect into it.
  { to: ROUTES.staffSupport, label: 'Support' },
  { to: ROUTES.adminOverview, label: 'Overview', superAdmin: true },
  { to: ROUTES.adminEvents, label: 'Events', superAdmin: true },
  { to: ROUTES.adminWorkshops, label: 'Workshops', superAdmin: true },
  { to: ROUTES.adminMess, label: 'Mess', superAdmin: true },
  { to: ROUTES.adminHostels, label: 'Hostels', superAdmin: true },
  { to: ROUTES.adminBackendTeams, label: 'Staff', superAdmin: true },
  // Story 7.3. Admin-flagged unlike Queries and Issues, because both routes
  // behind it are Super Admin only — a volunteer opening it would get a 403.
  { to: ROUTES.adminParticipants, label: 'Participants', superAdmin: true },
  { to: ROUTES.adminAnnouncements, label: 'Announcements', superAdmin: true },
  { to: ROUTES.adminAuditLogs, label: 'Audit Logs', superAdmin: true },
];

/**
 * The public brochure's perimeter-nav vocabulary, reused verbatim so the staff
 * rail and the `/events` rail read as one site: uppercase, wide tracking, no
 * panel behind it, and a brand-light pill on the current section.
 *
 * Kept identical to `NavLink` in `features/landing/PublicPageChrome.tsx` —
 * `text-brand-700` on `bg-brand-light` is 6.83:1, where plain `text-brand`
 * would only be 4.26:1.
 */
const NAV_BASE = 'tap text-sm font-semibold uppercase tracking-[0.2em] transition-colors';
const NAV_ACTIVE = 'rounded-full bg-brand-light px-4 py-2 text-brand-700';
const NAV_IDLE = 'px-4 py-2 text-muted hover:text-ink';

/**
 * Layout route for every staff/admin screen.
 *
 * The header is deliberately thin and transparent: every page renders its own
 * title through `FestivalScreen`, so the shell contributes navigation and the
 * backdrop, never a competing title bar. Clearing the session is enough to sign
 * out — `ProtectedRoute` owns the redirect.
 */
export function StaffShell() {
  const clear = useAuthStore((s) => s.clear);
  const staff = currentStaff();
  const superAdmin = isSuperAdmin();
  const links = NAV.filter(
    (item) => (!item.superAdmin || superAdmin) && !(item.hideForSuperAdmin && superAdmin),
  );

  return (
    <div className="relative flex min-h-full bg-canvas">
      {/* One backdrop behind the whole shell, as `PublicPageChrome` does. The
          rail has no panel of its own now, so it needs this ground to sit on —
          and it is what makes the staff area read as the same site. It clips
          itself, so no `overflow-hidden` here that would break the sticky rail. */}
      <AuroraBackdrop />

      {/* Desktop rail — panel-less and floating over the backdrop, exactly like
          the perimeter nav on the public brochure pages. */}
      <aside className="sticky top-0 z-20 hidden h-[100dvh] w-60 shrink-0 flex-col px-4 py-5 lg:flex xl:w-64">
        {/* Drops the first nav item to roughly the baseline the public rail sits
            at (it starts `top-16` under the brochure header). */}
        <Link to={ROUTES.staffHome} className="tap mb-24 flex items-center gap-2">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-brand to-accent text-base font-black text-white shadow-fab">
            P
          </span>
          <span className="truncate text-base font-black tracking-tight text-ink">
            Paradox Connect
          </span>
        </Link>

        <nav
          aria-label="Staff sections"
          className="flex min-h-0 flex-col items-start gap-5 overflow-y-auto"
        >
          {links.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === ROUTES.staffHome}
              className={({ isActive }) => cn(NAV_BASE, isActive ? NAV_ACTIVE : NAV_IDLE)}
            >
              {item.label}
            </NavLink>
          ))}
        </nav>

        {/* Where the public rail pins its social row, this pins the session. */}
        <div className="mt-auto flex flex-col items-start gap-1">
          {staff && (
            <p className="max-w-full truncate px-4 text-xs text-muted" title={staff.email}>
              {staff.email}
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
              {staff && <p className="truncate text-xs text-muted">{staff.email}</p>}
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

          {/* Mobile section nav. Same pill vocabulary as the rail, but kept on
              one scrolling line: seven wide-tracked labels wrap to three rows on
              a phone, which would push the page content off-screen. */}
          <nav
            aria-label="Staff sections"
            className="no-scrollbar flex gap-1 overflow-x-auto border-t border-line/60 px-3 py-2 lg:hidden"
          >
            {links.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === ROUTES.staffHome}
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
