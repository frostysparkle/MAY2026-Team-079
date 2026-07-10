import { useNavigate } from 'react-router-dom';
import { ROUTES } from '@/config/routes';
import { Button } from '@/components/ui';

/**
 * Shown when a signed-in user without the required role hits a protected route.
 * No protected content renders behind it — the guard redirects here instead.
 */
export default function AccessDeniedPage() {
  const navigate = useNavigate();
  return (
    <main className="mx-auto flex min-h-full max-w-md flex-col items-center justify-center gap-4 p-6 text-center">
      <div className="text-5xl" aria-hidden>
        🔒
      </div>
      <div>
        <h1 className="text-xl font-bold text-gray-900">Access denied</h1>
        <p className="mt-1 text-sm text-muted">
          You don&apos;t have permission to view this page. This area is restricted to specific
          roles, and your account isn&apos;t authorized for it.
        </p>
      </div>
      <Button onClick={() => navigate(ROUTES.home, { replace: true })}>Go to Home</Button>
    </main>
  );
}
