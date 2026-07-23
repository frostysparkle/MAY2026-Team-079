import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { ROUTES } from '@/config/routes';
import { useAuthStore, hasRoleAtLeast } from '@/stores/authStore';
import { ROLE_LABELS, type Role } from '@/config/constants';
import { clearSecrets } from '@/lib/secretStore';
import { cn } from '@/lib/cn';

interface StaffNavItem {
  to: string;
  label: string;
  icon: string;
  minRole: Role;
  end?: boolean;
}

/** Staff/admin navigation, role-filtered. Mirrors the management hub. */
const STAFF_NAV: StaffNavItem[] = [
  { to: ROUTES.overview, label: 'Operations', icon: '🧭', minRole: 'admin' },
  { to: ROUTES.scanner, label: 'Scan QR', icon: '📷', minRole: 'organizer' },
  { to: ROUTES.dashboard, label: 'Live Crowd', icon: '📊', minRole: 'admin' },
  { to: ROUTES.events, label: 'Events', icon: '📅', minRole: 'organizer' },
  { to: ROUTES.manageMess, label: 'Mess', icon: '🍽️', minRole: 'organizer' },
  { to: ROUTES.manageHostel, label: 'Hostel', icon: '🏨', minRole: 'admin' },
  { to: ROUTES.managePayments, label: 'Payments', icon: '💳', minRole: 'admin' },
  { to: ROUTES.manageQueries, label: 'Queries', icon: '🗂️', minRole: 'admin' },
  { to: ROUTES.manageContacts, label: 'Contacts', icon: '📇', minRole: 'admin' },
  { to: ROUTES.manageAnnouncements, label: 'Announcements', icon: '📣', minRole: 'admin' },
  { to: ROUTES.users, label: 'Users', icon: '👥', minRole: 'admin' },
];

/**
 * Layout for the staff/admin area. On laptops/tablets (`lg+`) it adds a sticky
 * left sidebar with role-filtered management navigation and gives each screen a
 * wide content area. On phones the sidebar is hidden and each screen keeps its
 * own PageHeader, so the mobile experience is unchanged. Viewport-driven — no
 * device sniffing. RBAC is still enforced per-route (and server-side).
 */
export function StaffShell() {
  const participant = useAuthStore((s) => s.participant);
  const clear = useAuthStore((s) => s.clear);
  const navigate = useNavigate();

  const items = STAFF_NAV.filter((item) => hasRoleAtLeast(item.minRole));

  const signOut = () => {
    void clearSecrets();
    clear();
    navigate(ROUTES.splash, { replace: true });
  };

  return (
    <div className="mx-auto flex min-h-full w-full max-w-7xl bg-canvas">
      <aside className="hidden shrink-0 border-r border-line/60 bg-surface/40 lg:sticky lg:top-0 lg:flex lg:h-screen lg:w-64 lg:flex-col lg:gap-2 lg:overflow-y-auto lg:p-4">
        <div className="flex items-center gap-2 px-2 py-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-brand to-accent text-sm font-bold text-white">
            P
          </div>
          <div className="min-w-0 leading-tight">
            <p className="text-sm font-bold text-ink">Paradox Staff</p>
            {participant && (
              <p className="truncate text-xs text-muted">{ROLE_LABELS[participant.role]}</p>
            )}
          </div>
        </div>

        <nav aria-label="Management" className="flex flex-1 flex-col gap-1">
          {items.map((item) => (
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

        <div className="flex flex-col gap-1 border-t border-line/60 pt-2">
          <NavLink
            to={ROUTES.home}
            className="tap flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-muted hover:bg-surface-2"
          >
            <span aria-hidden className="text-lg">
              ↩︎
            </span>
            Back to app
          </NavLink>
          <button
            type="button"
            onClick={signOut}
            className="tap flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-muted hover:bg-surface-2 hover:text-danger"
          >
            <span aria-hidden className="text-lg">
              ⏻
            </span>
            Sign out
          </button>
        </div>
      </aside>

      <div className="min-h-full w-full min-w-0 flex-1">
        <Outlet />
      </div>
    </div>
  );
}
