import { Link, useNavigate } from 'react-router-dom';
import { ROUTES } from '@/config/routes';
import { useAuthStore, hasRoleAtLeast } from '@/stores/authStore';
import { clearSecrets } from '@/lib/secretStore';
import { Card } from '@/components/ui';

interface Item {
  to: string;
  icon: string;
  title: string;
  subtitle: string;
}

const STUDENT_ITEMS: Item[] = [
  { to: ROUTES.mess, icon: '🍽️', title: 'Mess', subtitle: 'Menu & meal pass' },
  { to: ROUTES.hostel, icon: '🏨', title: 'Hostel', subtitle: 'Allocation & check-in' },
  { to: ROUTES.announcements, icon: '📣', title: 'Announcements', subtitle: 'Latest updates' },
  { to: ROUTES.payments, icon: '💳', title: 'Payments', subtitle: 'Hostel & mess fees' },
  { to: ROUTES.help, icon: '🆘', title: 'Help', subtitle: 'Queries & contacts' },
  { to: ROUTES.myQr, icon: '🔳', title: 'My Digital ID', subtitle: 'Full-screen QR' },
];

/**
 * "More" hub — the secondary destinations that don't earn a bottom-nav slot
 * (Req 8, 11.2). Staff and admins also get their management hub here so the
 * student-first nav stays uncluttered.
 */
export default function MorePage() {
  const navigate = useNavigate();
  const clear = useAuthStore((s) => s.clear);
  const canOrganize = hasRoleAtLeast('organizer');
  const canAdmin = hasRoleAtLeast('admin');

  const signOut = () => {
    void clearSecrets();
    clear();
    navigate(ROUTES.splash, { replace: true });
  };

  return (
    <div className="flex flex-col gap-6 p-4">
      <div>
        <h1 className="text-xl font-black tracking-tight text-ink">More</h1>
        <p className="text-sm text-muted">Everything else, one tap away.</p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {STUDENT_ITEMS.map((item) => (
          <Link key={item.to} to={item.to} className="block">
            <Card interactive className="flex h-full flex-col gap-2 p-4">
              <span aria-hidden className="text-xl">
                {item.icon}
              </span>
              <div>
                <p className="font-semibold text-ink">{item.title}</p>
                <p className="text-xs text-muted">{item.subtitle}</p>
              </div>
            </Card>
          </Link>
        ))}
      </div>

      {(canOrganize || canAdmin) && (
        <section className="flex flex-col gap-2">
          <h2 className="px-1 text-xs font-semibold uppercase tracking-wide text-muted">Manage</h2>
          <Card className="flex flex-col gap-1 p-2">
            {canAdmin && <Row to={ROUTES.overview} icon="🧭" label="Operations Dashboard" />}
            {canOrganize && <Row to={ROUTES.scanner} icon="📷" label="Scan QR" />}
            {canAdmin && <Row to={ROUTES.dashboard} icon="📊" label="Live Crowd" />}
            {canOrganize && <Row to={ROUTES.manageMess} icon="🍽️" label="Manage Mess" />}
            {canAdmin && <Row to={ROUTES.manageHostel} icon="🏨" label="Hostel Allocations" />}
            {canAdmin && <Row to={ROUTES.managePayments} icon="💳" label="Payments" />}
            {canAdmin && <Row to={ROUTES.manageQueries} icon="🗂️" label="Query Triage" />}
            {canAdmin && <Row to={ROUTES.manageContacts} icon="📇" label="Contact Directory" />}
            {canAdmin && <Row to={ROUTES.manageAnnouncements} icon="📣" label="Announcements" />}
            {canAdmin && <Row to={ROUTES.users} icon="👥" label="User Management" />}
          </Card>
        </section>
      )}

      <button
        type="button"
        onClick={signOut}
        className="tap self-start rounded-full px-4 py-2 text-sm font-medium text-muted hover:bg-surface-2 hover:text-danger active:scale-95"
      >
        Sign out
      </button>
    </div>
  );
}

function Row({ to, icon, label }: { to: string; icon: string; label: string }) {
  return (
    <Link
      to={to}
      className="tap flex items-center gap-3 rounded-xl px-3 py-2.5 hover:bg-surface-2 active:scale-[0.99]"
    >
      <span aria-hidden className="text-lg">
        {icon}
      </span>
      <span className="flex-1 text-sm font-medium text-ink">{label}</span>
      <span aria-hidden className="text-muted">
        ›
      </span>
    </Link>
  );
}
