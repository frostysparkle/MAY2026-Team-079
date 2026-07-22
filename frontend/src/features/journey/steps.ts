import type { Journey, JourneyStepKey, NextStep } from '@/api/types';
import { ROUTES } from '@/config/routes';

/** Ordered onboarding steps with labels for the progress UI. */
export const STEP_META: { key: JourneyStepKey; label: string }[] = [
  { key: 'profile', label: 'Profile' },
  { key: 'accommodation', label: 'Stay' },
  { key: 'mess', label: 'Food' },
  { key: 'payment', label: 'Payment' },
  { key: 'events', label: 'Events' },
];

/**
 * Where a given onboarding step lives. `done` routes to the student home; the
 * pipeline steps route to the onboarding screen (which renders the current step
 * from the journey).
 */
export function stepRoute(next: NextStep): string {
  return next === 'done' ? ROUTES.home : ROUTES.onboarding;
}

/** 1-based position of the next step for "step N of M" display. */
export function stepProgress(journey: Journey): { current: number; total: number } {
  const total = STEP_META.length;
  if (journey.complete && journey.nextStep === 'done') return { current: total, total };
  const idx = STEP_META.findIndex((s) => s.key === journey.nextStep);
  return { current: idx < 0 ? total : idx + 1, total };
}
