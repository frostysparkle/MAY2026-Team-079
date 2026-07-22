import { useNavigate } from 'react-router-dom';
import { ROUTES } from '@/config/routes';
import { Button } from '@/components/ui';
import { PORTAL_LABELS, type Portal } from '@/features/auth/portal';

/**
 * Splash / role landing. Three entry buttons choose which login screen to show
 * next. The Admin button is the shared entry for both Admin and Super Admin —
 * the actual role is resolved server-side after sign-in. These buttons carry no
 * permission of their own.
 */
export default function SplashPage() {
  const navigate = useNavigate();

  const choose = (portal: Portal) => {
    navigate(ROUTES.login, { state: { portal } });
  };

  return (
    <main className="relative flex min-h-full flex-col overflow-hidden bg-canvas">
      {/* Ambient brand glow backdrop. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-70"
        style={{
          background:
            'radial-gradient(60% 45% at 50% 0%, rgba(91,91,240,0.28), transparent 70%), radial-gradient(50% 40% at 90% 20%, rgba(236,72,153,0.18), transparent 70%)',
        }}
      />

      <div className="relative mx-auto flex min-h-full w-full max-w-md flex-1 flex-col justify-center gap-10 p-6">
        <div className="animate-rise flex flex-col items-center gap-4 text-center">
          <div className="flex h-20 w-20 items-center justify-center rounded-3xl bg-gradient-to-br from-brand to-accent text-3xl font-black text-white shadow-fab">
            P
          </div>
          <div>
            <h1 className="text-3xl font-black tracking-tight text-ink">Paradox Connect</h1>
            <p className="mt-2 text-sm text-muted">Your all-access pass to the Paradox fest</p>
          </div>
        </div>

        <div
          className="animate-rise flex w-full flex-col gap-3 rounded-3xl bg-surface/80 p-5 shadow-card ring-1 ring-black/[0.03] backdrop-blur"
          style={{ animationDelay: '80ms' }}
        >
          <p className="px-1 text-xs font-semibold uppercase tracking-wide text-muted">
            Continue as
          </p>
          <Button size="lg" fullWidth onClick={() => choose('student')}>
            {PORTAL_LABELS.student}
          </Button>
          <Button size="lg" fullWidth variant="secondary" onClick={() => choose('organizer')}>
            {PORTAL_LABELS.organizer}
          </Button>
          <Button size="lg" fullWidth variant="secondary" onClick={() => choose('admin')}>
            {PORTAL_LABELS.admin}
          </Button>
        </div>

        <p className="animate-fade mx-auto max-w-xs text-center text-xs text-muted">
          Access is verified after you sign in with your IITM Google account.
        </p>
      </div>
    </main>
  );
}
