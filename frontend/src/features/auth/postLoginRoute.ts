import type { Session } from '@/stores/authStore';
import { ROUTES } from '@/config/routes';

/**
 * Where a user lands after a successful sign-in.
 *
 * Participants with an incomplete profile (`full_name === null`, the backend's
 * "profile is {}" signal) always go to Complete Your Profile first.
 *
 * Staff land on whichever screen is actually theirs. `staffHome` is a *personal*
 * duty list, built by checking `session.id` against each entity's team array — so
 * it is the right first screen for a volunteer or an event head, and the wrong one
 * for a Super Admin, who is on none of those teams and would arrive at a
 * near-empty page. Super Admins go to the fest-wide control board instead. This is
 * the only role branch in the routing, and it mirrors the one in `StaffShell`'s
 * nav; there is still no static role hierarchy driving what a staffer can *see*,
 * only where they start.
 */
export function postLoginRoute(session: Session): string {
  if (session.token_type === 'staff') {
    return session.role === 'super_admin' ? ROUTES.adminOverview : ROUTES.staffHome;
  }
  if (session.full_name === null) return ROUTES.completeProfile;
  return ROUTES.home;
}
