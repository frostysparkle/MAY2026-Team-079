import { useNavigate } from 'react-router-dom';
import { ROUTES } from '@/config/routes';
import { Button, Card } from '@/components/ui';

/**
 * Final onboarding prompt — you're set up; register for events (Req 7). Both
 * paths leave onboarding: browsing events or heading to the home dashboard.
 */
export function EventsStep() {
  const navigate = useNavigate();
  return (
    <Card className="flex flex-col gap-4 text-center">
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-brand/10 text-2xl">
        🎉
      </div>
      <div>
        <h2 className="text-base font-bold text-ink">You’re all set!</h2>
        <p className="mt-1 text-sm text-muted">
          Your setup is complete. Explore the lineup and register for the events you love.
        </p>
      </div>
      <div className="flex flex-col gap-2">
        <Button fullWidth onClick={() => navigate(ROUTES.events)}>
          Browse events
        </Button>
        <Button fullWidth variant="secondary" onClick={() => navigate(ROUTES.home)}>
          Go to my home
        </Button>
      </div>
    </Card>
  );
}
