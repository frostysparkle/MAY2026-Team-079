import type { Participant } from '@/api/types';
import { ROUTES } from '@/config/routes';

/**
 * Where a user lands after a successful sign-in, based on the server-resolved
 * role and whether their profile is complete. Incomplete profiles always go to
 * Complete Your Profile first (FR-7.1).
 */
export function postLoginRoute(participant: Participant): string {
  if (!participant.profileComplete) return ROUTES.completeProfile;
  switch (participant.role) {
    case 'organizer':
      return ROUTES.scanner;
    case 'admin':
    case 'super_admin':
      return ROUTES.users;
    case 'participant':
    default:
      return ROUTES.home;
  }
}
