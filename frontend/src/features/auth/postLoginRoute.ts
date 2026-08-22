import type { Session } from '@/stores/authStore';
import { ROUTES } from '@/config/routes';
import { homeRoute } from '@/features/landing/roleSections';

/**
 * Where a user lands after a successful sign-in.
 *
 * Signing in does not switch the app into a different kind of interface — the
 * PARADOX portal at `homeRoute` remains every session's Home, reachable from the
 * wordmark on every screen. What this decides is narrower: the first screen worth
 * putting somebody on, which the guide words as routing "to the correct dashboard
 * after login" using `token_type` and, for staff, `role`.
 *
 * Participants with an incomplete profile (`full_name === null`, the backend's
 * "profile is {}" signal) always go to Complete Your Profile first.
 *
 * For staff the destination is the work, not the portal:
 *
 * | Who | Lands on | Why |
 * |---|---|---|
 * | `role: "super_admin"` | Fest Control Board | Fest-wide figures. They are on no entity team, so a duty list would be empty. |
 * | Everybody else | Duties | Their scanners, menu desks, participation views and answering queues — the whole reason they have an account. |
 *
 * There is deliberately no branch for `event_head`, UHC or a domain admin beyond
 * that. All three are recognised — `isEventHead`, `isUhc`, `isDomainAdminFor` —
 * but recognised *per entity*, from the team arrays the catalogue routes return,
 * which is not knowable at the moment of signing in without fetching every event.
 * `StaffHomePage` does that fetch and is what builds each of them their own
 * board: an Event Head sees Allocate/Edit Teams for their events, a UHC member and
 * a domain admin see Participation & Reports for the events they may read. So one
 * destination genuinely serves all three, and it is the right one.
 *
 * A previous revision sent every staff session to the portal instead. That was a
 * defensible reading of the portal-as-landing design, but it made signing in cost
 * an extra hop for every volunteer and put nobody in front of their work.
 */
export function postLoginRoute(session: Session): string {
  if (session.token_type === 'participant') {
    if (session.full_name === null) return ROUTES.completeProfile;
    return homeRoute(session);
  }
  return session.role === 'super_admin' ? ROUTES.adminOverview : ROUTES.staffDuties;
}
