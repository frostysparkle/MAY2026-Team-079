import type { EventParticipant } from '@/api/types';
import {
  existingTeamIds,
  groupParticipantsByTeam,
  teamRoleOptions,
  teamSizeWarning,
} from './participantTeams';

function person(
  participant_id: string,
  team_id: string | null,
  team_role: string | null = 'member',
  name: string | null = participant_id,
): EventParticipant {
  return {
    participant_id,
    name,
    email: `${participant_id.toLowerCase()}@ds.study.iitm.ac.in`,
    phone: '9000000000',
    house: 'wayanad',
    team_id,
    team_role,
    photo: null,
  };
}

describe('groupParticipantsByTeam', () => {
  it('groups by team id, named teams first and the unassigned last', () => {
    const groups = groupParticipantsByTeam([
      person('P1', 'TEAM_B'),
      person('P2', null),
      person('P3', 'TEAM_A'),
      person('P4', 'TEAM_B'),
    ]);

    expect(groups.map((g) => g.teamId)).toEqual(['TEAM_A', 'TEAM_B', null]);
    expect(groups[1].members.map((m) => m.participant_id)).toEqual(['P1', 'P4']);
    expect(groups[2].members.map((m) => m.participant_id)).toEqual(['P2']);
  });

  it('omits the unassigned group entirely when everybody has a team', () => {
    const groups = groupParticipantsByTeam([person('P1', 'T1'), person('P2', 'T1')]);
    expect(groups).toHaveLength(1);
    expect(groups[0].teamId).toBe('T1');
  });

  it('treats an empty or whitespace team id as unassigned, as the backend does', () => {
    const groups = groupParticipantsByTeam([person('P1', ''), person('P2', '   ')]);
    expect(groups.map((g) => g.teamId)).toEqual([null]);
    expect(groups[0].members).toHaveLength(2);
  });

  it('puts the leader first within a team, then sorts by name', () => {
    const groups = groupParticipantsByTeam([
      person('P1', 'T1', 'member', 'Zara'),
      person('P2', 'T1', 'leader', 'Meera'),
      person('P3', 'T1', 'member', 'Arjun'),
    ]);
    expect(groups[0].members.map((m) => m.name)).toEqual(['Meera', 'Arjun', 'Zara']);
  });

  it('falls back to the participant id when a profile has no name', () => {
    const groups = groupParticipantsByTeam([
      person('P2', 'T1', 'member', null),
      person('P1', 'T1', 'member', null),
    ]);
    expect(groups[0].members.map((m) => m.participant_id)).toEqual(['P1', 'P2']);
  });

  it('returns nothing for an empty roster', () => {
    expect(groupParticipantsByTeam([])).toEqual([]);
  });

  it('does not mutate the list it was given', () => {
    const roster = [person('P1', 'T1', 'member'), person('P2', 'T1', 'leader')];
    const order = roster.map((p) => p.participant_id);
    groupParticipantsByTeam(roster);
    expect(roster.map((p) => p.participant_id)).toEqual(order);
  });
});

describe('existingTeamIds', () => {
  it('lists each team once, sorted, ignoring the unassigned', () => {
    expect(
      existingTeamIds([
        person('P1', 'TEAM_B'),
        person('P2', null),
        person('P3', 'TEAM_A'),
        person('P4', 'TEAM_B'),
        person('P5', ''),
      ]),
    ).toEqual(['TEAM_A', 'TEAM_B']);
  });

  it('is empty when nobody is on a team', () => {
    expect(existingTeamIds([person('P1', null)])).toEqual([]);
  });
});

describe('teamRoleOptions', () => {
  it('offers the two roles the backend itself writes', () => {
    expect(teamRoleOptions('member')).toEqual(['leader', 'member']);
    expect(teamRoleOptions('leader')).toEqual(['leader', 'member']);
    expect(teamRoleOptions(null)).toEqual(['leader', 'member']);
    expect(teamRoleOptions('')).toEqual(['leader', 'member']);
  });

  it('keeps a hand-set role so opening the picker cannot silently rewrite it', () => {
    expect(teamRoleOptions('captain')).toEqual(['leader', 'member', 'captain']);
  });
});

describe('teamSizeWarning', () => {
  it('is silent for a team inside the rule', () => {
    expect(teamSizeWarning(3, { min: 2, max: 4 })).toBeNull();
    expect(teamSizeWarning(2, { min: 2, max: 4 })).toBeNull();
    expect(teamSizeWarning(4, { min: 2, max: 4 })).toBeNull();
  });

  it('reports a team short of the minimum', () => {
    expect(teamSizeWarning(1, { min: 3, max: 5 })).toBe('1 of 3 needed');
  });

  it('reports a team over the maximum', () => {
    expect(teamSizeWarning(6, { min: 2, max: 4 })).toBe('6 of 4 allowed');
  });

  it('does not complain about an individual event, where every team is one person', () => {
    // min/max default to 1, so a solo entry must not read as oversized.
    expect(teamSizeWarning(1, undefined)).toBeNull();
    expect(teamSizeWarning(1, { min: 1, max: 1 })).toBeNull();
  });
});
