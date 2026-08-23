/**
 * The roles a mess hall's or hostel block's team can hold.
 *
 * `POST /mess/{id}/team` and `POST /hostels/{id}/team` are **not** the same
 * vocabulary, despite both existing to staff a facility (`backend/routers/mess.py`
 * types `role` as `volunteer | other`; `backend/routers/hostels.py`'s
 * `HOSTEL_ROLES` is the separate, closed set `hostel_volunteer | guard`,
 * enforced with a `field_validator` that 422s anything else). Offering the
 * mess vocabulary on a hostel's team dialog — as this module used to, sharing
 * one constant across both — meant every hostel team assignment through the
 * admin UI 422'd.
 *
 * `MESS_TEAM_ROLES` / `HOSTEL_TEAM_ROLES` below are kept as two exported lists
 * for that reason, so a caller cannot accidentally reach for the wrong one.
 */

export const MESS_VOLUNTEER_ROLE = 'volunteer';
export const MESS_STAFF_ROLE = 'other';

export type MessTeamRole = typeof MESS_VOLUNTEER_ROLE | typeof MESS_STAFF_ROLE;

export const MESS_TEAM_ROLES: { value: MessTeamRole; label: string; blurb: string }[] = [
  {
    value: MESS_VOLUNTEER_ROLE,
    label: 'Volunteer',
    blurb: 'A student helping on the desk. Scanning is on from assignment.',
  },
  {
    value: MESS_STAFF_ROLE,
    label: 'Staff / other',
    blurb: 'Permanent staff — a warden, a caterer, a guard. Scanning is on from assignment.',
  },
];

/** `other` → `Staff / other`. An unrecognised role is shown as stored. */
export function messRoleLabel(role: string | null | undefined): string {
  if (!role) return 'Team member';
  const known = MESS_TEAM_ROLES.find((r) => r.value === role);
  return known ? known.label : role.replace(/_/g, ' ');
}

export const HOSTEL_VOLUNTEER_ROLE = 'hostel_volunteer';
export const HOSTEL_GUARD_ROLE = 'guard';

export type HostelTeamRole = typeof HOSTEL_VOLUNTEER_ROLE | typeof HOSTEL_GUARD_ROLE;

export const HOSTEL_TEAM_ROLES: { value: HostelTeamRole; label: string; blurb: string }[] = [
  {
    value: HOSTEL_VOLUNTEER_ROLE,
    label: 'Volunteer',
    blurb: 'Scans entries and exits, and handles on-ground issues raised against the block.',
  },
  {
    value: HOSTEL_GUARD_ROLE,
    label: 'Guard',
    blurb: 'Scanning only — entries and exits at the door.',
  },
];

/** `hostel_volunteer` → `Volunteer`. An unrecognised role is shown as stored. */
export function hostelRoleLabel(role: string | null | undefined): string {
  if (!role) return 'Team member';
  const known = HOSTEL_TEAM_ROLES.find((r) => r.value === role);
  return known ? known.label : role.replace(/_/g, ' ');
}
