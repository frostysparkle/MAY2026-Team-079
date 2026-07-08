import { useNavigate } from 'react-router-dom';
import { ROUTES } from '@/config/routes';
import { Button } from '@/components/ui';
import { PORTAL_LABELS, type Portal } from '@/features/auth/portal';

/**
 * Splash / role landing. Three entry buttons choose which login screen to show
 * next. Per the plan, the Admin button is the shared entry for both Admin and
 * Super Admin — the actual role is resolved server-side after sign-in. These
 * buttons carry no permission of their own.
 */
export default function SplashPage() {
  const navigate = useNavigate();

  const choose = (portal: Portal) => {
    navigate(ROUTES.login, { state: { portal } });
  };

  return (
    <main className="mx-auto flex min-h-full max-w-md flex-col items-center justify-center gap-8 p-6">
      <div className="flex flex-col items-center gap-3 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-brand text-2xl font-bold text-white">
          P
        </div>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Paradox Connect</h1>
          <p className="mt-1 text-sm text-muted">One platform for the Paradox fest</p>
        </div>
      </div>

      <div className="flex w-full flex-col gap-3">
        <Button fullWidth onClick={() => choose('student')}>
          {PORTAL_LABELS.student}
        </Button>
        <Button fullWidth variant="secondary" onClick={() => choose('organizer')}>
          {PORTAL_LABELS.organizer}
        </Button>
        <Button fullWidth variant="secondary" onClick={() => choose('admin')}>
          {PORTAL_LABELS.admin}
        </Button>
      </div>

      <p className="max-w-xs text-center text-xs text-muted">
        Access is verified after you sign in with your IITM Google account.
      </p>
    </main>
  );
}
