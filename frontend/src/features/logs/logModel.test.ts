import type { AuditLogEntry, EventLogRow, WorkshopLogRow } from '@/api/types';
import {
  fromAuditLogs,
  fromEventLogs,
  fromWorkshopLogs,
  peopleNamesFrom,
  type LogNames,
} from './logModel';

/**
 * Turning a log record into a line a person can read.
 *
 * A row used to be a label over a run of labelled ids — "Team member assigned",
 * then `BY BT1755…`, `TEAM USER ID DS413179`, `ROLE volunteer` — which left the
 * reader to work out that two similar-looking ids were two different people in two
 * different roles. These tests pin the sentences that replaced that, and the rule
 * that matters more than any individual phrasing: a name that could not be
 * resolved appears as its id, so a row is never less informative than the fields
 * it replaced.
 */

const ENTITIES = {
  MESS_PROBE2_413179: 'Mess hall 2',
  HST_A: 'Ganga Block',
  EVT_HACK: 'Hackathon',
  WS_ML: 'Intro to ML',
};

const NAMES: LogNames = { entities: ENTITIES };

const log = (over: Partial<AuditLogEntry> = {}): AuditLogEntry => ({
  timestamp: '2026-08-20T18:50:48Z',
  actor_id: 'BT413179',
  actor_name: 'Priya Raman',
  actor_type: 'staff',
  actor_role: 'super_admin',
  action: 'CREATE_MESS',
  target_id: 'MESS_PROBE2_413179',
  details: {},
  names: { BT413179: 'Priya Raman' },
  ...over,
});

/** The sentence for one entry, which is what a row leads with. */
const sentenceOf = (over: Partial<AuditLogEntry>, names: LogNames = NAMES): string =>
  fromAuditLogs([log(over)], names)[0].sentence;

describe('audit sentences', () => {
  it('names both people in a team assignment, and which is which', () => {
    // The row from the original report, which showed three ids and no names.
    expect(
      sentenceOf({
        action: 'ASSIGN_MESS_TEAM',
        details: { team_user_id: 'DS413179', role: 'volunteer' },
        names: { BT413179: 'Priya Raman', DS413179: 'Arjun Kumar' },
      }),
    ).toBe('Priya Raman assigned Arjun Kumar as volunteer to Mess hall 2');
  });

  it('leads a meal scan with the person who ate, not the person holding the scanner', () => {
    expect(
      sentenceOf({
        action: 'MESS_SCAN',
        actor_name: 'Mess Head',
        details: { participant_id: 'DS413179', slot: 'lunch', day: 2 },
        names: { BT413179: 'Mess Head', DS413179: 'Arjun Kumar' },
      }),
    ).toBe('Arjun Kumar was served lunch at Mess hall 2, recorded by Mess Head');
  });

  it('distinguishes entering a block from leaving it', () => {
    const entering = {
      action: 'HOSTEL_ENTRY',
      target_id: 'HST_A',
      actor_name: 'Ravi K',
      details: { participant_id: 'DS413179' },
      names: { BT413179: 'Ravi K', DS413179: 'Arjun Kumar' },
    };

    expect(sentenceOf(entering)).toBe('Arjun Kumar entered Ganga Block, recorded by Ravi K');
    expect(sentenceOf({ ...entering, action: 'HOSTEL_EXIT' })).toBe(
      'Arjun Kumar left Ganga Block, recorded by Ravi K',
    );
  });

  it('reports how much an allocation run actually did', () => {
    expect(
      sentenceOf({
        action: 'ALLOCATE_MESSES',
        target_id: null,
        details: { allocated_count: 412 },
      }),
    ).toBe('Priya Raman ran an allocation, filling 412 places');
  });

  it('counts one of something in the singular', () => {
    expect(
      sentenceOf({
        action: 'ALLOCATE_EVENT_TEAMS',
        target_id: 'EVT_HACK',
        details: { teams_created: 1 },
      }),
    ).toBe('Priya Raman ran an allocation for Hackathon, filling 1 team');
  });

  it('reads a participant acting on their own behalf in the first place', () => {
    expect(
      sentenceOf({
        action: 'EVENT_REGISTER',
        target_id: 'EVT_HACK',
        actor_id: 'DS413179',
        actor_name: 'Arjun Kumar',
        actor_type: 'participant',
        names: { DS413179: 'Arjun Kumar' },
      }),
    ).toBe('Arjun Kumar registered for Hackathon');
  });

  it('names the participant when the target is a person rather than a place', () => {
    // `UPDATE_PARTICIPANT` puts a participant_id in target_id, so the target has
    // to be resolved against the people map, not the entity directory.
    expect(
      sentenceOf({
        action: 'UPDATE_PARTICIPANT',
        target_id: 'DS413179',
        details: { fields_updated: ['house'] },
        names: { BT413179: 'Priya Raman', DS413179: 'Arjun Kumar' },
      }),
    ).toBe("Priya Raman updated Arjun Kumar's profile");
  });

  it('names the volunteer taken off a roster', () => {
    expect(
      sentenceOf({
        action: 'REMOVE_WORKSHOP_VOLUNTEER',
        target_id: 'WS_ML',
        details: { user_id: 'BT999' },
        names: { BT413179: 'Priya Raman', BT999: 'Sana M' },
      }),
    ).toBe('Priya Raman removed Sana M from Intro to ML');
  });

  it('phrases the plain record changes', () => {
    expect(sentenceOf({ action: 'CREATE_MESS' })).toBe('Priya Raman created Mess hall 2');
    expect(sentenceOf({ action: 'UPDATE_MESS_MENU' })).toBe('Priya Raman updated Mess hall 2');
    expect(sentenceOf({ action: 'DELETE_EVENT', target_id: 'EVT_HACK' })).toBe(
      'Priya Raman deleted Hackathon',
    );
  });
});

describe('when a name cannot be resolved', () => {
  it('shows the actor id rather than leaving a gap', () => {
    expect(sentenceOf({ actor_id: 'BT_GONE', actor_name: null, names: {} })).toBe(
      'BT_GONE created Mess hall 2',
    );
  });

  it('shows the target id when the page has no directory to look it up in', () => {
    // What the overview ticker gets: entries with names attached but no entity list.
    expect(sentenceOf({ action: 'CREATE_MESS' }, {})).toBe(
      'Priya Raman created MESS_PROBE2_413179',
    );
  });

  it('still reads as a sentence for an action this build has never seen', () => {
    expect(
      sentenceOf({ action: 'SOMETHING_NEW', target_id: 'ZZZ', actor_name: 'Priya Raman' }),
    ).toBe('Priya Raman performed SOMETHING_NEW ZZZ');
  });

  it('falls back to a role rather than naming nobody', () => {
    expect(
      sentenceOf({
        action: 'MESS_SCAN',
        details: { slot: 'dinner' },
        names: { BT413179: 'Mess Head' },
      }),
    ).toBe('A participant was served dinner at Mess hall 2, recorded by Priya Raman');
  });
});

describe('resolved fields', () => {
  it('reads people from the entry itself when the caller passes no names', () => {
    // The overview ticker relies on this: names arrive on each entry, so a row is
    // readable there without the page fetching anything extra.
    const [entry] = fromAuditLogs([
      log({
        action: 'ASSIGN_MESS_TEAM',
        details: { team_user_id: 'DS413179', role: 'volunteer' },
        names: { BT413179: 'Priya Raman', DS413179: 'Arjun Kumar' },
      }),
    ]);

    expect(entry.actorName).toBe('Priya Raman');
    expect(entry.facts).toContainEqual({ label: 'Member', value: 'Arjun Kumar' });
  });

  it('relabels a person id in details as the person', () => {
    // Was "Team user id DS413179", which reads as a puzzle rather than a fact.
    const [entry] = fromAuditLogs(
      [
        log({
          action: 'ASSIGN_MESS_TEAM',
          details: { team_user_id: 'DS413179', role: 'volunteer' },
          names: { DS413179: 'Arjun Kumar' },
        }),
      ],
      NAMES,
    );

    expect(entry.facts).toEqual([
      { label: 'Member', value: 'Arjun Kumar' },
      { label: 'Role', value: 'volunteer' },
    ]);
  });

  it('keeps a details id visible when it resolved to no name', () => {
    const [entry] = fromAuditLogs(
      [log({ action: 'ASSIGN_MESS_TEAM', details: { team_user_id: 'DS_GONE' }, names: {} })],
      NAMES,
    );

    expect(entry.facts).toEqual([{ label: 'Member', value: 'DS_GONE' }]);
  });

  it('leaves a name null when nothing resolved it, so a row can tell', () => {
    const [entry] = fromAuditLogs([log({ actor_id: 'BT_GONE', actor_name: null, names: {} })]);

    expect(entry.actorName).toBeNull();
    expect(entry.actorId).toBe('BT_GONE');
  });

  it('flags an actor whose account is gone, so the row can say why it shows a code', () => {
    // Without this the row reads as a broken screen rather than as a record whose
    // actor was removed after the fact.
    const [missing] = fromAuditLogs([
      log({ actor_id: 'TEMPSEED0001', actor_name: null, names: {} }),
    ]);
    expect(missing.actorMissing).toBe(true);

    const [known] = fromAuditLogs([log()]);
    expect(known.actorMissing).toBe(false);
  });

  it('keeps the ids untouched beside the names', () => {
    const [entry] = fromAuditLogs(
      [
        log({
          action: 'MESS_SCAN',
          details: { participant_id: 'DS413179', slot: 'lunch', day: 2 },
          names: { BT413179: 'Priya Raman', DS413179: 'Arjun Kumar' },
        }),
      ],
      NAMES,
    );

    // The CSV export and the per-entity views key on these.
    expect(entry.actorId).toBe('BT413179');
    expect(entry.participantId).toBe('DS413179');
    expect(entry.targetId).toBe('MESS_PROBE2_413179');
    expect(entry.participantName).toBe('Arjun Kumar');
    expect(entry.targetName).toBe('Mess hall 2');
  });

  it('carries the actor role through for a reader judging authority', () => {
    const [entry] = fromAuditLogs([log({ actor_role: 'super_admin' })]);
    expect(entry.actorRole).toBe('super_admin');
  });
});

describe('peopleNamesFrom', () => {
  it('pools the names the trail carries, for rows from sources that have none', () => {
    const people = peopleNamesFrom([
      log({ names: { BT413179: 'Priya Raman', DS413179: 'Arjun Kumar' } }),
      log({ actor_id: 'BT999', actor_name: 'Sana M', names: {} }),
    ]);

    expect(people).toEqual({
      BT413179: 'Priya Raman',
      DS413179: 'Arjun Kumar',
      BT999: 'Sana M',
    });
  });

  it('is empty rather than undefined for a trail with nothing resolved', () => {
    expect(peopleNamesFrom([log({ actor_name: null, names: {} })])).toEqual({});
  });
});

describe('scan rows', () => {
  const eventRow: EventLogRow = {
    event_id: 'EVT_HACK',
    participant_id: 'DS413179',
    scanned_by: 'BT999',
    day: '2026-08-20',
    timestamp: '2026-08-20T10:00:00Z',
  };

  const workshopRow: WorkshopLogRow = {
    workshop_id: 'WS_ML',
    participant_id: 'DS413179',
    action: 'attendance',
    scanned_by: 'BT999',
    scan_type: 'on-spot',
    timestamp: '2026-08-20T10:00:00Z',
  };

  const people = { DS413179: 'Arjun Kumar', BT999: 'Sana M' };

  it('names an event attendance scan from the names the trail supplied', () => {
    // `event_logs` stores only ids; the names are pooled from the audit trail for
    // the same entity rather than fetched again.
    const [entry] = fromEventLogs([eventRow], { entities: ENTITIES, people });

    expect(entry.sentence).toBe('Arjun Kumar was marked present at Hackathon, scanned by Sana M');
    expect(entry.actorName).toBe('Sana M');
    expect(entry.participantName).toBe('Arjun Kumar');
  });

  it('falls back to ids when no names were available', () => {
    const [entry] = fromEventLogs([eventRow]);

    expect(entry.sentence).toBe('DS413179 was marked present, scanned by BT999');
    expect(entry.actorName).toBeNull();
  });

  it('separates a workshop booking from turning up to it', () => {
    const names = { entities: ENTITIES, people };

    expect(fromWorkshopLogs([workshopRow], names)[0].sentence).toBe(
      'Arjun Kumar was marked present at Intro to ML, scanned by Sana M',
    );
    expect(fromWorkshopLogs([{ ...workshopRow, action: 'registration' }], names)[0].sentence).toBe(
      'Arjun Kumar booked a place at Intro to ML',
    );
  });
});
