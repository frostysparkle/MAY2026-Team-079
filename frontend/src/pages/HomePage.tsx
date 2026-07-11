import { Link } from 'react-router-dom';
import { ROUTES } from '@/config/routes';
import { useAuthStore } from '@/stores/authStore';
import { ROLE_LABELS } from '@/config/constants';
import { Card } from '@/components/ui';

/** Participant home/dashboard: greeting plus quick links to the main actions. */
export default function HomePage() {
  const participant = useAuthStore((s) => s.participant);
  const firstName = participant?.fullName?.split(' ')[0] || 'there';

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
    </div>
  );
}
