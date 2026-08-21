import type { WorkshopVolunteer } from '@/api/types';

/**
 * The two designations a workshop's staff can hold.
 *
 * `POST /workshops/{id}/volunteers` takes `role` as a free string and privileges
 * none of them — the backend's only per-member switch is `attendance`, which
 * gates scanning. So a designation is a *label an admin assigns*, stored on
 * `workshop_team[].role`: it records who is running the room and who is helping
 * at the door, and it is what the desk and the duty list show beside a name.
 *
 * It deliberately does not gate anything in this app either, because inventing a
 * client-side privilege the server does not enforce would be a lock with no bolt:
 * both designations get the two scanners and the workshop desk, and the server
 * decides on every scan. Nor can either be given the workshop log —
 * `GET /workshops/{id}/logs` is Super Admin-only and cannot be widened from here.
 */

export const WORKSHOP_VOLUNTEER_ROLE = 'workshop_volunteer';
export const WORKSHOP_MANAGER_ROLE = 'workshop_manager';

export const WORKSHOP_ROLES: { value: string; label: string; blurb: string }[] = [
  {
    value: WORKSHOP_VOLUNTEER_ROLE,
    label: 'Volunteer',
    blurb: 'Works the door: both scanners, and the workshop desk.',
  },
  {
    value: WORKSHOP_MANAGER_ROLE,
    label: 'Workshop Manager',
    blurb: 'Runs the room. Same access as a volunteer — the backend has one switch.',
  },
];

/** `workshop_manager` → `Workshop Manager`. An unknown role is shown as stored. */
export function workshopRoleLabel(role: string | undefined): string {
  if (!role) return 'Team member';
  const known = WORKSHOP_ROLES.find((r) => r.value === role);
  return known ? known.label : role.replace(/_/g, ' ');
}

/** True for the manager designation. Drives the icon on the team list, nothing else. */
export function isWorkshopManager(member: Pick<WorkshopVolunteer, 'role'>): boolean {
  return member.role === WORKSHOP_MANAGER_ROLE;
}
