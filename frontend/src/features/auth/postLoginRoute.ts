import type { Session } from '@/stores/authStore';
import { ROUTES } from '@/config/routes';
import { homeRoute } from '@/features/landing/roleSections';

/**
 * Where a user lands after a successful sign-in: their Landing Page.
 *
 * Signing in does not switch the app into a different kind of interface. It puts
 * the user on the same PARADOX portal a visitor sees, with the sections around
 * the wordmark filtered to what their role may open — so `/` → `/app` → `/staff`
 * are one experience, not three.
 *
 * Participants with an incomplete profile (`full_name === null`, the backend's
 * "profile is {}" signal) always go to Complete Your Profile first.
 *
 * There is no role branch left here. It used to send a Super Admin to the
 * fest-wide control board and everyone else to their personal duty list, because
 * a Super Admin is on none of those teams and would arrive at a near-empty page.
 * Both are now sections *on* the staff landing — Overview for a Super Admin,
 * Duties for everyone else — chosen by `landingSections`, so the entry point
 * itself no longer needs to know. There is still no static role hierarchy driving
 * what a staffer can *see*; the backend enforces that.
 */
export function postLoginRoute(session: Session): string {
  if (session.token_type === 'participant' && session.full_name === null) {
    return ROUTES.completeProfile;
  }
  return homeRoute(session);
}
