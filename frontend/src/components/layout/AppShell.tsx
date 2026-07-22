import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { ROUTES } from '@/config/routes';
import { useAuthStore } from '@/stores/authStore';
import { clearSecrets } from '@/lib/secretStore';
import { PageTransition } from '@/components/motion/PageTransition';
import { cn } from '@/lib/cn';

/** Bottom-nav tabs for the participant area. */
const NAV = [
  { to: ROUTES.home, label: 'Home', icon: '🏠', end: true },
  { to: ROUTES.events, label: 'Events', icon: '📅', end: false },
  { to: ROUTES.mess, label: 'Mess', icon: '🍽️', end: false },
  { to: ROUTES.myQr, label: 'My QR', icon: '🔳', end: false },
  { to: ROUTES.help, label: 'Help', icon: '🆘', end: false },
];

/**
 * Native-feeling app shell: a frosted sticky header, an animated bottom tab bar
 * with an active pill, and route transitions on the content. Fills the viewport
 * and respects device safe areas so it reads as an installed app, not a page.
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

  return (
    <div className="mx-auto flex min-h-full max-w-md flex-col bg-canvas">
      <header className="glass safe-top sticky top-0 z-30 border-b border-line/60">
        <div className="flex items-center justify-between px-4 py-3">
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
          <button
            type="button"
            onClick={signOut}
            className="tap rounded-full px-3 py-1.5 text-xs font-medium text-muted hover:bg-surface-2 hover:text-danger active:scale-95"
          >
            Sign out
          </button>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto pb-24">
        <PageTransition>
          <Outlet />
        </PageTransition>
      </main>

      <nav
        aria-label="Primary"
        className="glass safe-bottom fixed inset-x-0 bottom-0 z-30 mx-auto flex max-w-md border-t border-line/60"
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
  );
}
