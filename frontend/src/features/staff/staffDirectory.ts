import type { BackendTeamMember } from '@/api/types';
import type { BadgeTone } from '@/components/ui';

/**
 * The derived view of the staff directory that the dashboard reads.
 *
 * Unlike hostels and mess halls, a staff account has nothing to measure — no
 * capacity, no occupancy. What an admin needs to see instead is who holds
 * privilege and whether the records are complete, so that is what this module
 * derives: the super-admin count, the departments represented, and the accounts
 * missing a department or designation.
 *
 * `role` and `department` are free strings on the backend (`POST /backend_team`
 * validates neither), so nothing here assumes a fixed vocabulary. Values are
 * shown exactly as stored rather than prettified, because relabelling a value
 * this code has never seen would misrepresent it.
 */

/** Roles that carry unrestricted access. The only value the backend privileges. */
export const SUPER_ADMIN_ROLE = 'super_admin';

export interface StaffRow {
  /** The record this row was derived from, for actions that need the whole thing. */
  member: BackendTeamMember;
  id: string;
  email: string;
  /** Stored verbatim; `super_admin` is the only value with meaning to the API. */
  role: string;
  roleTone: BadgeTone;
  isSuperAdmin: boolean;
  /** Empty string when unset, which the UI renders as an em dash. */
  department: string;
  designation: string;
  /** True when either descriptive field is blank. */
  incomplete: boolean;
  /**
   * Whether this account is tied to a participant record.
   *
   * `POST /backend_teams` sets `admin_id` when the email it was given also
   * belongs to a participant, and nothing can change it afterwards. It is not
   * decoration: it is the link the backend follows to decide that somebody
   * registering for an event is on that event's team, and therefore to refuse the
   * registration. An unlinked account is a staff member the event-team check
   * cannot see, which is worth being able to spot from the list.
   */
  linkedToParticipant: boolean;
}

export function buildStaffRows(team: BackendTeamMember[]): StaffRow[] {
  return team.map((member) => {
    const role = member.role ?? '';
    const isSuperAdmin = role === SUPER_ADMIN_ROLE;
    const department = (member.department ?? '').trim();
    const designation = (member.designation ?? '').trim();

    return {
      member,
      id: member.paradox_id,
      email: member.email,
      role,
      // Privilege is the one thing worth colouring: an admin scanning this list is
      // usually checking who can do everything.
      roleTone: isSuperAdmin ? 'warning' : 'neutral',
      isSuperAdmin,
      department,
      designation,
      incomplete: department === '' || designation === '',
      linkedToParticipant: Boolean(member.admin_id),
    };
  });
}

export interface StaffSummary {
  accounts: number;
  superAdmins: number;
  /** Distinct non-blank departments, sorted, for both the figure and the filter. */
  departments: string[];
  /** Distinct non-blank roles, sorted. */
  roles: string[];
  /** Accounts missing a department or a designation. */
  incomplete: number;
}

export function summariseStaff(rows: StaffRow[]): StaffSummary {
  const distinct = (values: string[]) => [...new Set(values.filter(Boolean))].sort();

  return {
    accounts: rows.length,
    superAdmins: rows.filter((row) => row.isSuperAdmin).length,
    departments: distinct(rows.map((row) => row.department)),
    roles: distinct(rows.map((row) => row.role)),
    incomplete: rows.filter((row) => row.incomplete).length,
  };
}

/** Blank fields read as an em dash, so a row never looks half-rendered. */
export function orDash(value: string): string {
  return value === '' ? '—' : value;
}
