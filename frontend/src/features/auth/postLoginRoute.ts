import { api } from '@/api';
import type { Participant } from '@/api/types';
import { ROUTES } from '@/config/routes';
import { stepRoute } from '@/features/journey/steps';

/**
 * Synchronous role-based fallback used when a journey lookup isn't available
 * (or fails). Incomplete profiles always go to the onboarding pipeline first;
 * staff and admins land on their own surfaces (FR-7.1, Req 1.4).
 */
export function postLoginRoute(participant: Participant): string {
  switch (participant.role) {
    case 'organizer':
      return ROUTES.scanner;
    case 'admin':
    case 'super_admin':
      return ROUTES.users;
    case 'participant':
    default:
      return participant.profileComplete ? ROUTES.home : ROUTES.onboarding;
  }
}

/**
 * Where a student lands after signing in. Staff/admin keep their role surfaces;
 * students are routed by their derived onboarding journey so they resume at the
 * exact next step (profile → stay → food → payment → events → home). Falls back
 * to the role-based route if the journey can't be loaded (Req 2.2, 2.8, 11.4).
 */
export async function resolvePostLoginRoute(participant: Participant): Promise<string> {
  if (participant.role !== 'participant') return postLoginRoute(participant);
  try {
    const journey = await api.getJourney();
    return stepRoute(journey.nextStep);
  } catch {
    return postLoginRoute(participant);
  }
}
