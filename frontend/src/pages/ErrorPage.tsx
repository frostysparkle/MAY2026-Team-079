import { useRouteError } from 'react-router-dom';
import { AlertTriangle } from 'lucide-react';
import { Button, IconTile } from '@/components/ui';

/**
 * Router `errorElement` — the last line of defence when a route throws during
 * render or loading. Eagerly imported (never lazy) so it can't itself fail to
 * load while handling a failure.
 */
export default function ErrorPage() {
  const error = useRouteError();
  const detail =
    error instanceof Error ? error.message : typeof error === 'string' ? error : undefined;

  return (
    <main className="mx-auto flex min-h-full max-w-md flex-col items-center justify-center gap-4 p-6 text-center">
      <IconTile icon={AlertTriangle} tone="danger" size="lg" />
      <div>
        <h1 className="text-xl font-black tracking-tight text-ink">Something broke</h1>
        <p className="mt-1 text-sm text-muted">
          This screen hit an unexpected error. Reloading usually clears it.
        </p>
        {detail && (
          <p className="mt-2 break-words rounded-lg bg-surface-2 p-2 text-left font-mono text-xs text-muted">
            {detail}
          </p>
        )}
      </div>
      <Button onClick={() => window.location.assign('/')}>Reload the app</Button>
    </main>
  );
}
