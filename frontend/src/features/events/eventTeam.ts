/**
 * The three designations an event's staff can hold.
 *
 * Unlike a workshop's designations — which are labels the backend privileges not
 * at all — these are load-bearing. `POST /events/{id}/allocate_teams` and
 * `PUT /events/{id}/participant_teams/{pid}` both check for
 * `role === "event_head"` on `event_team` and refuse everybody else, Super
 * Admins included (`backend/routers/events.py`). So the value chosen here is
 * what decides who can run team allocation for this event, and it is the one
 * place in the app where that authority is granted.
 *
 * Scanning is the other side of it: any role in `event_team` may scan
 * attendance for the event (`POST /events/{id}/scan` checks membership, not
 * role), and there is no per-member `logging`/`attendance` switch on events the
 * way there is on messes, blocks, and workshops.
 */

import type { BackendTeamDepartment } from '@/api/types';

export const EVENT_HEAD_ROLE = 'event_head';
/**
 * The backend's vocabulary is `event_head` | `member` | `volunteer`
 * (`models.EventTeamAssignRequest.role`) — `member`, not `event_member`. The
 * label shown in the UI stays "Event Member"; only the wire value has to
 * match what `POST /events/{id}/team` actually accepts.
 */
export const EVENT_MEMBER_ROLE = 'member';
export const EVENT_VOLUNTEER_ROLE = 'volunteer';

/** The exact vocabulary `EventTeamAssignRequest.role` accepts. */
export type EventTeamRole =
  typeof EVENT_HEAD_ROLE | typeof EVENT_MEMBER_ROLE | typeof EVENT_VOLUNTEER_ROLE;

export const EVENT_TEAM_ROLES: { value: EventTeamRole; label: string; blurb: string }[] = [
  {
    value: EVENT_HEAD_ROLE,
    label: 'Event Head',
    blurb: 'Runs the event. The only role that can allocate teams or edit a participant’s team.',
  },
  {
    value: EVENT_MEMBER_ROLE,
    label: 'Event Member',
    blurb: 'Core team. Sees the participant list and can scan attendance.',
  },
  {
    value: EVENT_VOLUNTEER_ROLE,
    label: 'Volunteer',
    blurb: 'Works the gate: scans attendance for this event.',
  },
];

/**
 * Departments an event's staff account can carry.
 *
 * `POST /backend_teams` validates `department` against the closed set in
 * `models.BACKEND_TEAM_DEPARTMENTS` — there is no "events" value, and a
 * department is not optional, so a new account minted for this event must name
 * one. "uhc" is the Upper House Council's own desk and "hostels"/"mess"/
 * "workshops" belong to their own team panels, leaving the three categories an
 * event can actually have. Event 22's creator hit exactly this: the panel used
 * to post `"events"`, which the backend refuses with a 422 naming the whole
 * accepted set (`Input should be 'technical', 'sports', …`).
 */
export const EVENT_STAFF_DEPARTMENTS = ['technical', 'sports', 'culturals'] as const;

/**
 * The department to write on a staff account created for this event.
 *
 * The backend compares `backend_teams.department` straight against the event's
 * `event_type` (`GET /events/{id}/participation` authorises a departmental
 * admin that way), and the paradox_id prefix encodes it ("ADSP…" for an admin
 * in sports), so the account should carry the event's own category. An
 * "others" event has no matching department — that value exists only on
 * `event_type` — so those fall back to "technical", the same default the event
 * editor's own category dropdown opens on.
 */
export function departmentForEvent(eventType: string | undefined): BackendTeamDepartment {
  return EVENT_STAFF_DEPARTMENTS.find((dept) => dept === eventType) ?? 'technical';
}

/** `event_head` → `Event Head`. An unknown role is shown as stored. */
export function eventTeamRoleLabel(role: string | undefined): string {
  if (!role) return 'Team member';
  const known = EVENT_TEAM_ROLES.find((r) => r.value === role);
  return known ? known.label : role.replace(/_/g, ' ');
}

/** True for the Event Head designation — the one role the backend privileges. */
export function isEventHeadRole(role: string | undefined): boolean {
  return role === EVENT_HEAD_ROLE;
}

/**
 * The shape both team sources share.
 *
 * `event_team` off a `GET /events` record is `{ user_id, role }`; the same array
 * off `GET /events/{id}/participation` is enriched with `name` and `phone`. Every
 * helper here needs only the two common fields, so they accept either.
 */
export interface EventTeamRoleBearer {
  user_id: string;
  role: string;
}

/**
 * Is this staff member the Event Head of this event?
 *
 * The same test the backend makes before allowing `allocate_teams` or a
 * participant-team edit (`backend/routers/events.py`), so a screen can disable
 * those controls instead of offering a button that is certain to 403.
 *
 * `staffId` is a `paradox_id`. Compared as a string because the backend stores
 * `event_team[].user_id` unvalidated and stringifies it on the way out
 * (`str(member.get("user_id"))`).
 */
export function isEventHead(
  team: readonly EventTeamRoleBearer[] | undefined,
  staffId: string | undefined,
): boolean {
  if (!team || !staffId) return false;
  return team.some((member) => member.user_id === staffId && isEventHeadRole(member.role));
}

/** Is this staff member on the event's team at all, in any role? */
export function isOnEventTeam(
  team: readonly EventTeamRoleBearer[] | undefined,
  staffId: string | undefined,
): boolean {
  if (!team || !staffId) return false;
  return team.some((member) => member.user_id === staffId);
}

/** Every Event Head on this event, for the "who can do this instead" hint. */
export function eventHeads<T extends EventTeamRoleBearer>(team: readonly T[] | undefined): T[] {
  return (team ?? []).filter((member) => isEventHeadRole(member.role));
}

/** This member's role on the event, or `undefined` if they are not on it. */
export function eventTeamRoleOf(
  team: readonly EventTeamRoleBearer[] | undefined,
  staffId: string | undefined,
): string | undefined {
  if (!team || !staffId) return undefined;
  return team.find((member) => member.user_id === staffId)?.role;
}

/**
 * What `POST /events/{id}/allocate_teams` actually told us.
 *
 * The route answers 200 in three materially different situations and
 * distinguishes them only by prose:
 *
 *   - `"Not a team event"` — `team.max <= 1`, so there is nothing to allocate.
 *     Not a failure, and not something to celebrate either.
 *   - `"Allocated 0 teams"` — it ran and formed nothing, because every registrant
 *     already has a team or too few solo players remain to reach `team.min`.
 *   - `"Allocated N teams"` — it worked.
 *
 * Rendering all three in one banner tone (as this screen used to) means a
 * successful run looks like a warning and a no-op looks like a success. The
 * message is matched rather than parsed strictly: an unrecognised 200 is treated
 * as a notice, which is the safe direction — it reports what the server said
 * without claiming an outcome.
 */
export type AllocationOutcome = {
  tone: 'success' | 'notice';
  title: string;
  description?: string;
};

export function readAllocationOutcome(message: string): AllocationOutcome {
  const trimmed = message.trim();

  if (/^not a team event$/i.test(trimmed)) {
    return {
      tone: 'notice',
      title: 'Nothing to allocate',
      description:
        'This event’s team size is 1, so entries are individual. Raise the maximum team size on the event to use allocation.',
    };
  }

  const allocated = /^allocated\s+(\d+)\s+teams?$/i.exec(trimmed);
  if (allocated) {
    const count = Number(allocated[1]);
    if (count === 0) {
      return {
        tone: 'notice',
        title: 'No teams were formed',
        description:
          'Everybody registered already has a team, or too few unassigned participants remain to reach the event’s minimum team size.',
      };
    }
    return {
      tone: 'success',
      title: `Allocated ${count} team${count === 1 ? '' : 's'}`,
      description: 'Only unassigned solo entries were grouped; existing teams were left alone.',
    };
  }

  return { tone: 'notice', title: trimmed };
}

/* ------------------------------------------------------ contact directory --- */

/**
 * Placeholders the backend puts where a real contact detail is missing.
 *
 * `GET /events/{id}/participation` builds each team member from whichever
 * collection has them, and when there is no participant profile to read it
 * substitutes the literal strings below rather than leaving the field null
 * (`backend/routers/events.py`). Rendering those as a phone number produces a
 * `tel:Unknown` link, so they have to be recognised as absence.
 */
const PHONE_PLACEHOLDERS = new Set(['', 'unknown', 'n/a', 'na', 'none', 'null']);

/** Is there a number here worth offering as a `tel:` link? */
export function isReachablePhone(phone: string | null | undefined): boolean {
  const trimmed = (phone ?? '').trim();
  if (PHONE_PLACEHOLDERS.has(trimmed.toLowerCase())) return false;
  // At least a few digits: a designation that leaked into the phone field is not
  // a number to ring.
  return /\d{4,}/.test(trimmed);
}

/**
 * Team members in the order a reader wants them: Event Heads first, then the rest
 * by name.
 *
 * The head is who a UHC officer or a domain admin needs, and the backend returns
 * the array in whatever order it was assigned in.
 */
export function orderEventTeam<T extends EventTeamRoleBearer & { name?: string }>(
  team: readonly T[],
): T[] {
  return [...team].sort((a, b) => {
    const aHead = isEventHeadRole(a.role) ? 0 : 1;
    const bHead = isEventHeadRole(b.role) ? 0 : 1;
    if (aHead !== bHead) return aHead - bHead;
    return (a.name || a.user_id).localeCompare(b.name || b.user_id);
  });
}
