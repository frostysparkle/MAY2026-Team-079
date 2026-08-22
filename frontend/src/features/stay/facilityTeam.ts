/**
 * The two roles a mess hall's or hostel block's team can hold.
 *
 * `POST /mess/{id}/team` and `POST /hostels/{id}/team` both type `role` as
 * `volunteer | other` and both whitelist the same two values when deciding the
 * new member's `logging` flag — so either role arrives able to scan, and the
 * choice is a record of what the person is rather than a permission
 * (`backend/routers/mess.py`, `backend/routers/hostels.py`).
 *
 * It was worth exposing anyway: both admin dialogs hardcoded `'other'`, so every
 * member added through the UI was filed as staff whatever they actually were, and
 * the role shown beside their name on the duty list was wrong for every student
 * volunteer.
 */

export const FACILITY_VOLUNTEER_ROLE = 'volunteer';
export const FACILITY_STAFF_ROLE = 'other';

export type FacilityTeamRole = typeof FACILITY_VOLUNTEER_ROLE | typeof FACILITY_STAFF_ROLE;

export const FACILITY_TEAM_ROLES: { value: FacilityTeamRole; label: string; blurb: string }[] = [
  {
    value: FACILITY_VOLUNTEER_ROLE,
    label: 'Volunteer',
    blurb: 'A student helping on the desk. Scanning is on from assignment.',
  },
  {
    value: FACILITY_STAFF_ROLE,
    label: 'Staff / other',
    blurb: 'Permanent staff — a warden, a caterer, a guard. Scanning is on from assignment.',
  },
];

/** `other` → `Staff / other`. An unrecognised role is shown as stored. */
export function facilityRoleLabel(role: string | null | undefined): string {
  if (!role) return 'Team member';
  const known = FACILITY_TEAM_ROLES.find((r) => r.value === role);
  return known ? known.label : role.replace(/_/g, ' ');
}
