import { Link } from 'react-router-dom';
import { ROUTES } from '@/config/routes';
import { useAuthStore, hasRoleAtLeast } from '@/stores/authStore';
import { ROLE_LABELS } from '@/config/constants';
import { Card } from '@/components/ui';

/** Participant home/dashboard: greeting plus quick links to the main actions. */
export default function HomePage() {
  const participant = useAuthStore((s) => s.participant);
  const firstName = participant?.fullName?.split(' ')[0] || 'there';
  const canOrganize = hasRoleAtLeast('organizer');
  const canAdmin = hasRoleAtLeast('admin');

  return (
    <div className="flex flex-col gap-4 p-4">
      <div>
        <h1 className="text-lg font-bold text-gray-900">Hi, {firstName} 👋</h1>
        {participant && (
          <p className="text-sm text-muted">Signed in as {ROLE_LABELS[participant.role]}</p>
        )}
      </div>

      <Link to={ROUTES.myQr} className="block">
        <Card className="flex items-center gap-3 transition-colors hover:border-brand">
          <span className="text-2xl" aria-hidden>
            🔳
          </span>
          <div>
            <p className="font-semibold text-gray-900">My Digital ID</p>
            <p className="text-sm text-muted">Show your QR at any checkpoint</p>
          </div>
        </Card>
      </Link>

      <Link to={ROUTES.events} className="block">
        <Card className="flex items-center gap-3 transition-colors hover:border-brand">
          <span className="text-2xl" aria-hidden>
            📅
          </span>
          <div>
            <p className="font-semibold text-gray-900">Events</p>
            <p className="text-sm text-muted">Schedule, venues, and entry rules</p>
          </div>
        </Card>
      </Link>

      <Link to={ROUTES.help} className="block">
        <Card className="flex items-center gap-3 transition-colors hover:border-brand">
          <span className="text-2xl" aria-hidden>
            🆘
          </span>
          <div>
            <p className="font-semibold text-gray-900">Help &amp; Support</p>
            <p className="text-sm text-muted">Raise a query or find a contact</p>
          </div>
        </Card>
      </Link>

      <Link to={ROUTES.profile} className="block">
        <Card className="flex items-center gap-3 transition-colors hover:border-brand">
          <span className="text-2xl" aria-hidden>
            👤
          </span>
          <div>
            <p className="font-semibold text-gray-900">My Profile</p>
            <p className="text-sm text-muted">View your details</p>
          </div>
        </Card>
      </Link>

      {(canOrganize || canAdmin) && (
        <div className="mt-2 flex flex-col gap-2">
          <p className="text-xs font-medium uppercase tracking-wide text-muted">Manage</p>
          {canOrganize && <ManageLink to={ROUTES.scanner} icon="📷" label="Scan QR" />}
          {canOrganize && <ManageLink to={ROUTES.events} icon="📅" label="Manage Events" />}
          {canAdmin && <ManageLink to={ROUTES.users} icon="👥" label="User Management" />}
          {canAdmin && <ManageLink to={ROUTES.manageQueries} icon="🗂️" label="Query Triage" />}
          {canAdmin && <ManageLink to={ROUTES.manageContacts} icon="📇" label="Contact Directory" />}
        </div>
      )}
    </div>
  );
}

function ManageLink({ to, icon, label }: { to: string; icon: string; label: string }) {
  return (
    <Link to={to} className="block">
      <Card className="flex items-center gap-3 py-3 transition-colors hover:border-brand">
        <span className="text-xl" aria-hidden>
          {icon}
        </span>
        <p className="font-medium text-gray-900">{label}</p>
      </Card>
    </Link>
  );
}
