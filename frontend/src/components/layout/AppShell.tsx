import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { ROUTES } from '@/config/routes';
import { useAuthStore } from '@/stores/authStore';
import { clearSecrets } from '@/lib/secretStore';
import { PageTransition } from '@/components/motion/PageTransition';
import { cn } from '@/lib/cn';

/** Primary navigation, shared by the mobile bottom bar and the desktop sidebar. */
const NAV = [
  { to: ROUTES.home, label: 'Home', icon: '🏠', end: true },
  { to: ROUTES.events, label: 'Events', icon: '📅', end: false },
  { to: ROUTES.passes, label: 'My Pass', icon: '🎟️', end: false },
  { to: ROUTES.more, label: 'More', icon: '⋯', end: false },
  { to: ROUTES.profile, label: 'Profile', icon: '👤', end: false },
];

/**
 * Responsive app shell. On phones it reads as a native app: a frosted sticky
 * header and a bottom tab bar. On tablets/laptops (`lg+`) it becomes a
 * productivity layout with a left sidebar and a wide, centered content column.
 * The switch is driven by the viewport (CSS breakpoints), not device sniffing,
 * so it adapts to resizing, split-screen, and every form factor.
 */
export function AppShell() {
  const participant = useAuthStore((s) => s.participant);
  const clear = useAuthStore((s) => s.clear);
  const navigate = useNavigate();

  const signOut = () => {
    // Clear cached TOTP secrets too, so a shared/handed-over device can't keep
    // generating this participant's codes.
    void clearSecrets();
    clear();
    navigate(ROUTES.splash, { replace: true });
  };

  const brand = (
    <div className="flex min-w-0 items-center gap-2">
      <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-brand to-accent text-sm font-bold text-white">
        P
      </div>
      <div className="min-w-0 leading-tight">
        <p className="text-sm font-bold text-ink">Paradox Connect</p>
        {participant && (
          <p className="truncate text-xs text-muted">
            {participant.fullName || participant.email}
          </p>
        )}
      </div>
    </div>
  );

  return (
    <div className="mx-auto flex min-h-full w-full max-w-md flex-col bg-canvas lg:max-w-7xl lg:flex-row">
      {/* Desktop sidebar — laptops/tablets only. */}
      <aside className="hidden shrink-0 border-r border-line/60 bg-surface/40 lg:sticky lg:top-0 lg:flex lg:h-screen lg:w-64 lg:flex-col lg:gap-2 lg:overflow-y-auto lg:p-4">
        <div className="px-2 py-3">{brand}</div>
        <nav aria-label="Primary" className="flex flex-1 flex-col gap-1">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                cn(
                  'tap flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold',
                  isActive ? 'bg-brand-100 text-brand' : 'text-muted hover:bg-surface-2',
                )
              }
            >
              <span aria-hidden className="text-lg">
                {item.icon}
              </span>
              {item.label}
            </NavLink>
          ))}
        </nav>
        <button
          type="button"
          onClick={signOut}
          className="tap flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-muted hover:bg-surface-2 hover:text-danger"
        >
          <span aria-hidden className="text-lg">
            ↩︎
          </span>
          Sign out
        </button>
      </aside>

      {/* Content column. */}
      <div className="flex min-h-full w-full flex-1 flex-col">
        {/* Mobile header — hidden on desktop (the sidebar carries brand + sign out). */}
        <header className="glass safe-top sticky top-0 z-30 border-b border-line/60 lg:hidden">
          <div className="flex items-center justify-between px-4 py-3">
            {brand}
            <button
              type="button"
              onClick={signOut}
              className="tap rounded-full px-3 py-1.5 text-xs font-medium text-muted hover:bg-surface-2 hover:text-danger active:scale-95"
            >
              Sign out
            </button>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto pb-24 lg:pb-10">
          <div className="lg:mx-auto lg:max-w-4xl lg:px-6 lg:py-4">
            <PageTransition>
              <Outlet />
            </PageTransition>
          </div>
        </main>

        {/* Bottom tab bar — phones/tablets in portrait; hidden on desktop. */}
        <nav
          aria-label="Primary"
          className="glass safe-bottom fixed inset-x-0 bottom-0 z-30 mx-auto flex max-w-md border-t border-line/60 lg:hidden"
        >
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className="tap flex flex-1 flex-col items-center gap-1 py-2.5"
            >
              {({ isActive }) => (
                <>
                  <span
                    aria-hidden
                    className={cn(
                      'flex h-8 w-12 items-center justify-center rounded-full text-lg transition-all duration-200',
                      isActive ? 'scale-105 bg-brand-100 text-brand' : 'text-muted',
                    )}
                  >
                    {item.icon}
                  </span>
                  <span
                    className={cn(
                      'text-[10px] font-medium transition-colors',
                      isActive ? 'text-brand' : 'text-muted',
                    )}
                  >
                    {item.label}
                  </span>
                </>
              )}
            </NavLink>
          ))}
        </nav>
      </div>
    </div>
  );
}
