import { useNavigate } from 'react-router-dom';
import { ROUTES } from '@/config/routes';
import { AuthLayout } from '@/features/auth/AuthLayout';
import { Button } from '@/components/ui';

/**
 * Shown when a signed-in user without the required role hits a protected route.
 * No protected content renders behind it — the guard redirects here instead.
 */
export default function AccessDeniedPage() {
  const navigate = useNavigate();
  return (
    <AuthLayout>
      <div className="flex flex-col items-center gap-4 rounded-3xl bg-surface/90 p-8 text-center shadow-lift ring-1 ring-black/[0.04] backdrop-blur">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-danger-bg text-3xl" aria-hidden>
          🔒
        </div>
        <div>
          <h1 className="text-xl font-black tracking-tight text-ink">Access denied</h1>
          <p className="mt-1 text-sm text-muted">
            You don&apos;t have permission to view this page. This area is restricted to specific
            roles, and your account isn&apos;t authorized for it.
          </p>
        </div>
        <Button fullWidth onClick={() => navigate(ROUTES.home, { replace: true })}>
          Go to Home
        </Button>
      </div>
    </AuthLayout>
  );
}
