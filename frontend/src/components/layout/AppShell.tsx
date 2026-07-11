import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { ROUTES } from '@/config/routes';
import { useAuthStore } from '@/stores/authStore';
import { clearSecrets } from '@/lib/secretStore';
import { cn } from '@/lib/cn';

/** Bottom-nav tabs for the participant area. */
const NAV = [
  { to: ROUTES.home, label: 'Home', icon: '🏠', end: true },
  { to: ROUTES.profile, label: 'Profile', icon: '👤', end: false },
  { to: ROUTES.myQr, label: 'My QR', icon: '🔳', end: false },
];

/**
 * Navigation shell for participant screens: a header with the signed-in user and
 * a bottom navigation bar. Child routes render into <Outlet />. The plan lists
 * Profile and My QR; a Home tab is added as the landing/dashboard target that
 * profile completion redirects to.
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
    <div className="mx-auto flex min-h-full max-w-md flex-col bg-surface">
      <header className="flex items-center justify-between border-b border-line px-4 py-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-brand">Paradox Connect</p>
          {participant && (
            <p className="truncate text-xs text-muted">
              {participant.fullName || participant.email}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={signOut}
          className="rounded-md px-2 py-1 text-xs font-medium text-muted hover:text-danger"
        >
          Sign out
        </button>
      </header>

      <main className="flex-1 overflow-y-auto pb-20">
        <Outlet />
      </main>

      <nav
        aria-label="Primary"
        className="fixed inset-x-0 bottom-0 mx-auto flex max-w-md border-t border-line bg-surface"
      >
        {NAV.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) =>
              cn(
                'flex flex-1 flex-col items-center gap-0.5 py-2 text-xs',
                isActive ? 'text-brand' : 'text-muted',
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
    </div>
  );
}
