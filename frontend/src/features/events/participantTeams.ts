import type { EventParticipant } from '@/api/types';

/**
 * Registrants arranged by the team they are on.
 *
 * `GET /events/{id}/participation` returns one flat list with `team_id` on each
 * row, which is the wrong shape for the job the Event Head is actually doing:
 * "is this team full, and who is still loose?" Answering that from a flat list
 * means the reader does the grouping in their head, which is what made the old
 * screen a wall of identical cards.
 *
 * `null` for `teamId` is the unassigned bucket — the only group allocation acts
 * on, since `POST /events/{id}/allocate_teams` groups solo entries and leaves
 * existing teams alone.
 */
export interface ParticipantTeamGroup {
  teamId: string | null;
  members: EventParticipant[];
}

/** Empty string and whitespace are treated as unassigned, as the backend does. */
function normaliseTeamId(teamId: string | null | undefined): string | null {
  const trimmed = (teamId ?? '').trim();
  return trimmed === '' ? null : trimmed;
}

/**
 * Group registrants by `team_id`, named teams first in id order, then the
 * unassigned bucket last — the reading order an organiser wants: settled teams
 * to scan past, outstanding work at the bottom.
 *
 * Within a team, a `leader` sorts to the top and the rest go by name, so the
 * person to contact about that team is the first line of its card.
 */
export function groupParticipantsByTeam(
  participants: readonly EventParticipant[],
): ParticipantTeamGroup[] {
  const byTeam = new Map<string, EventParticipant[]>();
  const unassigned: EventParticipant[] = [];

  for (const participant of participants) {
    const teamId = normaliseTeamId(participant.team_id);
    if (teamId === null) {
      unassigned.push(participant);
      continue;
    }
    const existing = byTeam.get(teamId);
    if (existing) existing.push(participant);
    else byTeam.set(teamId, [participant]);
  }

  const groups: ParticipantTeamGroup[] = [...byTeam.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([teamId, members]) => ({ teamId, members: [...members].sort(byLeaderThenName) }));

  if (unassigned.length > 0) {
    groups.push({ teamId: null, members: [...unassigned].sort(byLeaderThenName) });
  }

  return groups;
}

function byLeaderThenName(a: EventParticipant, b: EventParticipant): number {
  const aLead = a.team_role === 'leader' ? 0 : 1;
  const bLead = b.team_role === 'leader' ? 0 : 1;
  if (aLead !== bLead) return aLead - bLead;
  return (a.name || a.participant_id).localeCompare(b.name || b.participant_id);
}

/** Every team id already in use on this event, for the "move to…" picker. */
export function existingTeamIds(participants: readonly EventParticipant[]): string[] {
  const ids = new Set<string>();
  for (const participant of participants) {
    const teamId = normaliseTeamId(participant.team_id);
    if (teamId !== null) ids.add(teamId);
  }
  return [...ids].sort((a, b) => a.localeCompare(b));
}

/**
 * The two roles the backend itself writes: `POST /events/{id}/register` sets
 * `leader` for whoever supplied the team name and `member` for everybody else.
 *
 * `PUT /events/{id}/participant_teams/{pid}` accepts any string, so this is a
 * convenience vocabulary rather than a constraint — but offering it as a choice
 * is what stops a typo silently creating a third role nothing recognises.
 */
export const TEAM_ROLES = ['leader', 'member'] as const;

/**
 * Role options for one participant, including whatever they hold now even if it
 * is outside the vocabulary above — so opening the picker on a hand-set role
 * cannot silently rewrite it on save.
 */
export function teamRoleOptions(current: string | null | undefined): string[] {
  const held = (current ?? '').trim();
  if (held === '' || TEAM_ROLES.includes(held as (typeof TEAM_ROLES)[number])) {
    return [...TEAM_ROLES];
  }
  return [...TEAM_ROLES, held];
}

/**
 * How far a team is from being legal under the event's own rule.
 *
 * Allocation only ever forms teams that already satisfy `min`, but a hand edit
 * can leave one short or over `max`, and nothing server-side objects — so the
 * screen has to be the thing that says so.
 */
export function teamSizeWarning(
  size: number,
  rule: { min?: number; max?: number } | undefined,
): string | null {
  const min = rule?.min ?? 1;
  const max = rule?.max ?? 1;
  if (size < min) return `${size} of ${min} needed`;
  if (max > 1 && size > max) return `${size} of ${max} allowed`;
  return null;
}
