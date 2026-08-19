import { useNavigate } from 'react-router-dom';
import { Compass } from 'lucide-react';
import { ROUTES } from '@/config/routes';
import { useAuthStore } from '@/stores/authStore';
import { Button, IconTile } from '@/components/ui';

/** Router catch-all for unknown paths. */
export default function NotFoundPage() {
  const navigate = useNavigate();
  const session = useAuthStore((s) => s.session);
  const home = session?.token_type === 'staff' ? ROUTES.staffHome : ROUTES.home;

  return (
    <main className="mx-auto flex min-h-full max-w-md flex-col items-center justify-center gap-4 p-6 text-center">
      <IconTile icon={Compass} tone="muted" size="lg" />
      <div>
        <h1 className="text-xl font-black tracking-tight text-ink">Page not found</h1>
        <p className="mt-1 text-sm text-muted">
          That link doesn&apos;t point anywhere in Paradox Connect.
        </p>
      </div>
      <Button onClick={() => navigate(session ? home : ROUTES.splash, { replace: true })}>
        {session ? 'Go to Home' : 'Go to Start'}
      </Button>
    </main>
  );
}
