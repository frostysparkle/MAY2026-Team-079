import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ROUTES } from '@/config/routes';
import { useJourney } from '@/features/journey/useJourney';
import { STEP_META, stepProgress } from '@/features/journey/steps';
import type { Journey, JourneyStepState } from '@/api/types';
import { AuthLayout } from '@/features/auth/AuthLayout';
import { ErrorState, Skeleton } from '@/components/ui';
import { AccommodationStep } from './steps/AccommodationStep';
import { MessStep } from './steps/MessStep';
import { PaymentStep } from './steps/PaymentStep';
import { EventsStep } from './steps/EventsStep';

/**
 * Onboarding pipeline host (spec: student-experience-redesign, Req 2). Renders
 * the *current* step derived from the server-side journey — never a URL-driven
 * step — so a deep link to /onboarding always resumes at `next_step` and
 * out-of-order navigation is impossible (Req 2.8, 11.4). The profile step reuses
 * the dedicated Complete Your Profile screen; a finished journey lands home.
 */
export default function OnboardingLayout() {
  const navigate = useNavigate();
  const { journey, status, reload } = useJourney();

  useEffect(() => {
    if (status !== 'ready' || !journey) return;
    if (journey.nextStep === 'profile') {
      navigate(ROUTES.completeProfile, { replace: true });
    } else if (journey.nextStep === 'done') {
      navigate(ROUTES.home, { replace: true });
    }
  }, [status, journey, navigate]);

  if (status === 'loading') {
    return (
      <AuthLayout>
        <div className="flex flex-col gap-4">
          <Skeleton className="h-8 w-40" />
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-48" />
        </div>
      </AuthLayout>
    );
  }

  if (status === 'error' || !journey) {
    return (
      <AuthLayout>
        <ErrorState
          description="Could not load your setup progress."
          onRetry={() => void reload()}
        />
      </AuthLayout>
    );
  }

  // Redirecting to profile / home — render nothing to avoid a flash.
  if (journey.nextStep === 'profile' || journey.nextStep === 'done') return null;

  const advance = async () => {
    await reload();
  };

  return (
    <AuthLayout header={<ProgressHeader journey={journey} />}>
      {journey.nextStep === 'accommodation' && <AccommodationStep onDone={advance} />}
      {journey.nextStep === 'mess' && <MessStep onDone={advance} />}
      {journey.nextStep === 'payment' && <PaymentStep journey={journey} />}
      {journey.nextStep === 'events' && <EventsStep />}
    </AuthLayout>
  );
}

const DOT: Record<JourneyStepState, string> = {
  done: 'bg-brand text-white',
  current: 'bg-brand text-white ring-4 ring-brand/20',
  upcoming: 'bg-surface-2 text-muted',
  skipped: 'bg-surface-2 text-muted/60',
};

function ProgressHeader({ journey }: { journey: Journey }) {
  const { current, total } = stepProgress(journey);
  const stateOf = (key: string) =>
    journey.steps.find((s) => s.key === key)?.state ?? 'upcoming';

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-black tracking-tight text-ink">Let’s get you set up</h1>
        <span className="text-xs font-medium text-muted">
          Step {current} of {total}
        </span>
      </div>
      <ol className="flex items-center gap-1.5">
        {STEP_META.map((step, i) => {
          const state = stateOf(step.key);
          return (
            <li key={step.key} className="flex flex-1 flex-col items-center gap-1">
              <span
                className={`flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-bold ${DOT[state]}`}
              >
                {state === 'done' ? '✓' : state === 'skipped' ? '–' : i + 1}
              </span>
              <span
                className={`text-[10px] font-medium ${
                  state === 'current' ? 'text-ink' : 'text-muted'
                }`}
              >
                {step.label}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
