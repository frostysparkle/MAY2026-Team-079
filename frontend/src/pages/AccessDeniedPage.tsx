import { useNavigate } from 'react-router-dom';
import { ShieldX } from 'lucide-react';
import { ROUTES } from '@/config/routes';
import { useAuthStore } from '@/stores/authStore';
import { Button, IconTile } from '@/components/ui';

/**
 * Shown when a signed-in user without the required token type/role hits a
 * protected route. No protected content renders behind it — the guard
 * redirects here instead.
 */
export default function AccessDeniedPage() {
  const navigate = useNavigate();
  const session = useAuthStore((s) => s.session);
  const home = session?.token_type === 'staff' ? ROUTES.staffHome : ROUTES.home;
  return (
    <main className="mx-auto flex min-h-full max-w-md flex-col items-center justify-center gap-4 p-6 text-center">
      <IconTile icon={ShieldX} tone="danger" size="lg" />
      <div>
        <h1 className="text-xl font-black tracking-tight text-ink">Access denied</h1>
        <p className="mt-1 text-sm text-muted">
          You don&apos;t have permission to view this page. This area is restricted to specific
          roles, and your account isn&apos;t authorized for it.
        </p>
      </div>
      <Button onClick={() => navigate(home, { replace: true })}>Go to Home</Button>
    </main>
  );
}
