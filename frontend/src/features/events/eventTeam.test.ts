import {
  EVENT_HEAD_ROLE,
  EVENT_VOLUNTEER_ROLE,
  eventHeads,
  eventTeamRoleLabel,
  eventTeamRoleOf,
  isEventHead,
  isOnEventTeam,
  readAllocationOutcome,
} from './eventTeam';

const TEAM = [
  { user_id: 'BT1', role: EVENT_HEAD_ROLE },
  { user_id: 'BT2', role: EVENT_VOLUNTEER_ROLE },
  { user_id: 'BT3', role: 'event_member' },
];

describe('isEventHead', () => {
  it('is true only for the member holding event_head', () => {
    expect(isEventHead(TEAM, 'BT1')).toBe(true);
    expect(isEventHead(TEAM, 'BT2')).toBe(false);
    expect(isEventHead(TEAM, 'BT3')).toBe(false);
  });

  it('is false for anybody not on the team, and when either side is missing', () => {
    expect(isEventHead(TEAM, 'BT9')).toBe(false);
    expect(isEventHead(TEAM, undefined)).toBe(false);
    // `event_team` is stripped from some responses, so undefined must read as
    // "cannot confirm" rather than throwing or granting.
    expect(isEventHead(undefined, 'BT1')).toBe(false);
    expect(isEventHead([], 'BT1')).toBe(false);
  });
});

describe('isOnEventTeam', () => {
  it('admits any role, which is what the scan route checks', () => {
    expect(isOnEventTeam(TEAM, 'BT2')).toBe(true);
    expect(isOnEventTeam(TEAM, 'BT3')).toBe(true);
    expect(isOnEventTeam(TEAM, 'BT9')).toBe(false);
    expect(isOnEventTeam(undefined, 'BT1')).toBe(false);
  });
});

describe('eventHeads / eventTeamRoleOf', () => {
  it('lists every head, so an event with two is not misreported as one', () => {
    const two = [...TEAM, { user_id: 'BT4', role: EVENT_HEAD_ROLE }];
    expect(eventHeads(two).map((m) => m.user_id)).toEqual(['BT1', 'BT4']);
    expect(eventHeads([])).toEqual([]);
    expect(eventHeads(undefined)).toEqual([]);
  });

  it('reports the caller’s own role, or undefined off-team', () => {
    expect(eventTeamRoleOf(TEAM, 'BT2')).toBe(EVENT_VOLUNTEER_ROLE);
    expect(eventTeamRoleOf(TEAM, 'BT9')).toBeUndefined();
    expect(eventTeamRoleOf(undefined, 'BT1')).toBeUndefined();
  });
});

describe('eventTeamRoleLabel', () => {
  it('labels the known vocabulary and passes anything else through readably', () => {
    expect(eventTeamRoleLabel('event_head')).toBe('Event Head');
    expect(eventTeamRoleLabel('event_member')).toBe('Event Member');
    expect(eventTeamRoleLabel('volunteer')).toBe('Volunteer');
    // The backend stores `role` unvalidated, so an unknown value must still read.
    expect(eventTeamRoleLabel('stage_manager')).toBe('stage manager');
    expect(eventTeamRoleLabel(undefined)).toBe('Team member');
  });
});

describe('readAllocationOutcome', () => {
  it('treats a real allocation as a success', () => {
    const outcome = readAllocationOutcome('Allocated 7 teams');
    expect(outcome.tone).toBe('success');
    expect(outcome.title).toBe('Allocated 7 teams');
  });

  it('singularises one team', () => {
    expect(readAllocationOutcome('Allocated 1 teams').title).toBe('Allocated 1 team');
  });

  it('treats zero teams as a notice, not a success', () => {
    // The route returns 200 here, but nothing happened — reporting it green is
    // what made an organiser think allocation had worked.
    const outcome = readAllocationOutcome('Allocated 0 teams');
    expect(outcome.tone).toBe('notice');
    expect(outcome.title).toBe('No teams were formed');
    expect(outcome.description).toMatch(/minimum team size/);
  });

  it('treats "Not a team event" as a notice with an explanation', () => {
    const outcome = readAllocationOutcome('Not a team event');
    expect(outcome.tone).toBe('notice');
    expect(outcome.title).toBe('Nothing to allocate');
    expect(outcome.description).toMatch(/team size is 1/);
  });

  it('reports an unrecognised 200 verbatim as a notice', () => {
    // Safe direction: say what the server said without claiming an outcome.
    const outcome = readAllocationOutcome('Something new happened');
    expect(outcome.tone).toBe('notice');
    expect(outcome.title).toBe('Something new happened');
  });

  it('is insensitive to case and surrounding whitespace', () => {
    expect(readAllocationOutcome('  not a team event  ').tone).toBe('notice');
    expect(readAllocationOutcome('ALLOCATED 3 TEAMS').tone).toBe('success');
  });
});
