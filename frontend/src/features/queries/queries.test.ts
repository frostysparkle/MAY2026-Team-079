import type {
  Event,
  Hostel,
  Mess,
  MyEventRegistration,
  MyHostelResponse,
  MyMessResponse,
  MyWorkshopRegistration,
  QueryRecord,
  QueryReply,
  Workshop,
} from '@/api/types';
import {
  ASSIGNABLE_STATUSES,
  askerLine,
  availableTargets,
  categoryLabel,
  categoryMeta,
  countQueries,
  draftToRequest,
  EMPTY_DRAFT,
  formatQueryTime,
  hasStaffReply,
  isOutstanding,
  isUnanswered,
  latestReply,
  offerableCategories,
  outstandingByCategory,
  sortForDuty,
  statusLabel,
  statusTone,
  targetLabel,
  targetsFor,
  validateDraft,
} from './queries';

/**
 * Epic 6's pure rules.
 *
 * The theme is that this module must never accept something `POST /queries` would
 * refuse, and never refuse something it would accept — with one stated exception,
 * the 3-character floor. So most of these assert the shape of what leaves the
 * browser, and the rest assert the two derived readings a queue depends on:
 * outstanding, and unanswered.
 */

const GANGA: Hostel = {
  hostel_id: 'GANGA',
  name: 'Ganga Block',
  capacity: 300,
  gender: 'male',
  coordinator: {},
  hostel_team: [],
};

const HALL: Mess = {
  mess_id: 'NILGIRI',
  name: 'Nilgiri Mess',
  capacity: 500,
  preference: 'veg',
  cuisines: ['south_indian'],
  mess_team: [],
};

const HACKATHON = {
  event_id: 'EV_HACK',
  event_type: 'technical',
  name: 'Paradox Hackathon',
  description: '',
  team: { min: 1, max: 4, house: false, allow_single_registration: true },
  open: true,
  prize_money: [],
  registration: {},
  schedule: [],
  registration_fields: [],
  event_team: [],
} as Event;

const WORKSHOP = {
  workshop_id: 'WS_ML',
  slot_id: 'S1',
  name: 'Intro to ML',
  description: '',
  venue: 'CLT',
  capacity: 60,
  instructions: '',
  registration_count: 0,
  participant_count: 0,
} as unknown as Workshop;

const MY_HOSTEL = { assigned_hostel: 'GANGA', room: '214' } as MyHostelResponse;
const MY_MESS = { allotted_mess: 'NILGIRI', mess_details: HALL, slots: [] } as MyMessResponse;

function reply(overrides: Partial<QueryReply> = {}): QueryReply {
  return {
    author_id: 'BT1',
    author_type: 'staff',
    author_name: 'Block Volunteer',
    body: 'On our way.',
    timestamp: '2026-08-20T10:00:00',
    ...overrides,
  };
}

function query(overrides: Partial<QueryRecord> = {}): QueryRecord {
  return {
    query_id: 'QRY1',
    participant_id: 'DS23F1000042',
    participant_name: 'Meera R',
    participant_house: 'Ganga',
    category: 'hostel',
    target_id: 'GANGA',
    subject: 'No water',
    body: 'Since last night.',
    status: 'open',
    assigned_team: null,
    assigned_to: null,
    replies: [],
    created_at: '2026-08-20T09:00:00',
    updated_at: '2026-08-20T09:00:00',
    resolved_at: null,
    ...overrides,
  };
}

describe('categories', () => {
  it('labels every category the backend accepts', () => {
    for (const value of ['hostel', 'mess', 'event', 'workshop', 'general']) {
      expect(categoryMeta(value)).not.toBeNull();
      expect(categoryLabel(value)).not.toBe('Uncategorised');
    }
  });

  it('reads an unknown category as words rather than hiding it', () => {
    // A category the backend gains before this file catches up must still show up
    // on a query the participant can see they raised.
    expect(categoryLabel('lost_property')).toBe('Lost property');
    expect(categoryLabel('')).toBe('Uncategorised');
  });

  it('marks general as the one category that needs no entity', () => {
    expect(categoryMeta('general')?.needsTarget).toBe(false);
    for (const value of ['hostel', 'mess', 'event', 'workshop']) {
      expect(categoryMeta(value)?.needsTarget).toBe(true);
    }
  });
});

describe('statuses', () => {
  it('labels and tones the three statuses the backend allows', () => {
    expect(ASSIGNABLE_STATUSES).toEqual(['open', 'assigned', 'resolved']);
    expect(statusLabel('resolved')).toBe('Answered');
    expect(statusTone('open')).toBe('warning');
    expect(statusTone('assigned')).toBe('info');
    expect(statusTone('resolved')).toBe('success');
  });

  it('open is a warning rather than a danger', () => {
    // Unanswered is the normal first state of every query ever raised; red would
    // make a working queue look like a fault.
    expect(statusTone('open')).not.toBe('danger');
  });

  it('falls back rather than throwing on a status it does not know', () => {
    expect(statusLabel('escalated')).toBe('escalated');
    expect(statusTone('escalated')).toBe('neutral');
  });
});

describe('availableTargets', () => {
  it('offers the events and workshops this participant registered for', () => {
    const targets = availableTargets({
      registrations: [{ event_id: 'EV_HACK' } as MyEventRegistration],
      events: [HACKATHON],
      workshopRegistrations: [{ workshop_id: 'WS_ML' } as MyWorkshopRegistration],
      workshops: [WORKSHOP],
    });

    expect(targets).toEqual([
      { category: 'event', id: 'EV_HACK', name: 'Paradox Hackathon' },
      { category: 'workshop', id: 'WS_ML', name: 'Intro to ML' },
    ]);
  });

  it('offers the block and hall this participant was actually allotted', () => {
    const targets = availableTargets({
      hostel: MY_HOSTEL,
      hostels: [GANGA],
      mess: MY_MESS,
      messHalls: [HALL],
    });

    expect(targets).toEqual([
      { category: 'hostel', id: 'GANGA', name: 'Ganga Block' },
      { category: 'mess', id: 'NILGIRI', name: 'Nilgiri Mess' },
    ]);
  });

  it('drops a registration whose event is not in the catalogue', () => {
    // `POST /queries` 404s on an event id it cannot find, so an unresolvable
    // option would be a button that cannot work.
    const targets = availableTargets({
      registrations: [{ event_id: 'EV_GONE' } as MyEventRegistration],
      events: [HACKATHON],
    });
    expect(targets).toEqual([]);
  });

  it('falls back to the id when a catalogue read failed', () => {
    // The query would still be filed and routed correctly, so losing the name is
    // not a reason to lose the option.
    const targets = availableTargets({ hostel: MY_HOSTEL, hostels: null });
    expect(targets).toEqual([{ category: 'hostel', id: 'GANGA', name: 'GANGA' }]);
  });

  it('offers nothing for a participant allotted nowhere and registered for nothing', () => {
    expect(availableTargets({})).toEqual([]);
  });

  it('still leaves general available to somebody with no targets at all', () => {
    // Otherwise a participant who has registered for nothing has nobody to ask.
    const offerable = offerableCategories([]);
    expect(offerable.map((c) => c.value)).toEqual(['general']);
  });

  it('offers only the categories that have something to point at', () => {
    const targets = availableTargets({ hostel: MY_HOSTEL, hostels: [GANGA] });
    expect(offerableCategories(targets).map((c) => c.value)).toEqual(['hostel', 'general']);
  });

  it('narrows targets to one category', () => {
    const targets = availableTargets({
      hostel: MY_HOSTEL,
      hostels: [GANGA],
      mess: MY_MESS,
      messHalls: [HALL],
    });
    expect(targetsFor(targets, 'mess')).toEqual([
      { category: 'mess', id: 'NILGIRI', name: 'Nilgiri Mess' },
    ]);
    expect(targetsFor(targets, 'event')).toEqual([]);
  });
});

describe('validateDraft', () => {
  const targets = availableTargets({ hostel: MY_HOSTEL, hostels: [GANGA] });

  it('accepts a complete draft', () => {
    expect(
      validateDraft(
        { category: 'hostel', targetId: 'GANGA', subject: 'No water', body: 'Since last night.' },
        targets,
      ),
    ).toEqual({});
  });

  it('rejects an empty draft field by field', () => {
    const errors = validateDraft(EMPTY_DRAFT, targets);
    expect(errors.category).toBeDefined();
    expect(errors.subject).toBeDefined();
    expect(errors.body).toBeDefined();
  });

  it('requires a target for every category but general', () => {
    expect(
      validateDraft(
        { category: 'hostel', targetId: '', subject: 'Hello', body: 'Anybody?' },
        targets,
      ).targetId,
    ).toBeDefined();

    expect(
      validateDraft(
        { category: 'general', targetId: '', subject: 'Lost my ID', body: 'Replacement?' },
        targets,
      ),
    ).toEqual({});
  });

  it('rejects a target that is not one of this participant\u2019s own', () => {
    expect(
      validateDraft(
        { category: 'hostel', targetId: 'KAVERI', subject: 'Hello', body: 'Anybody?' },
        targets,
      ).targetId,
    ).toBeDefined();
  });

  it('trims before measuring, so whitespace is not a question', () => {
    const errors = validateDraft(
      { category: 'general', targetId: '', subject: '   ', body: '   ' },
      targets,
    );
    expect(errors.subject).toBeDefined();
    expect(errors.body).toBeDefined();
  });

  it('refuses an over-long subject rather than letting the server truncate it', () => {
    const errors = validateDraft(
      { category: 'general', targetId: '', subject: 'x'.repeat(200), body: 'Anybody?' },
      targets,
    );
    expect(errors.subject).toMatch(/under 120/);
  });
});

describe('draftToRequest', () => {
  const targets = availableTargets({ hostel: MY_HOSTEL, hostels: [GANGA] });

  it('builds exactly what POST /queries wants', () => {
    expect(
      draftToRequest(
        {
          category: 'hostel',
          targetId: 'GANGA',
          subject: '  No water  ',
          body: '  Since last night.  ',
        },
        targets,
      ),
    ).toEqual({
      category: 'hostel',
      target_id: 'GANGA',
      subject: 'No water',
      body: 'Since last night.',
    });
  });

  it('omits target_id entirely for a general query', () => {
    // The backend drops it either way; sending a key it will discard invites the
    // two to disagree.
    const request = draftToRequest(
      { category: 'general', targetId: 'GANGA', subject: 'Lost my ID', body: 'Replacement?' },
      targets,
    );
    expect(request).toEqual({ category: 'general', subject: 'Lost my ID', body: 'Replacement?' });
    expect(request && 'target_id' in request).toBe(false);
  });

  it('returns null rather than a half-built request', () => {
    expect(draftToRequest(EMPTY_DRAFT, targets)).toBeNull();
    expect(
      draftToRequest({ category: 'hostel', targetId: '', subject: 'Hi', body: 'There' }, targets),
    ).toBeNull();
  });
});

describe('outstanding and unanswered', () => {
  it('counts anything not resolved as outstanding', () => {
    expect(isOutstanding(query({ status: 'open' }))).toBe(true);
    expect(isOutstanding(query({ status: 'assigned' }))).toBe(true);
    expect(isOutstanding(query({ status: 'resolved' }))).toBe(false);
  });

  it('separates "claimed" from "answered"', () => {
    // This is the distinction the panel exists for: a query marked assigned tells
    // the participant a name and nothing else.
    const claimedButSilent = query({ status: 'assigned', assigned_to: 'BT1' });
    expect(hasStaffReply(claimedButSilent)).toBe(false);
    expect(isUnanswered(claimedButSilent)).toBe(true);
  });

  it('does not count the asker\u2019s own follow-up as an answer', () => {
    const nagged = query({ replies: [reply({ author_type: 'participant' })] });
    expect(hasStaffReply(nagged)).toBe(false);
    expect(isUnanswered(nagged)).toBe(true);
  });

  it('stops counting as unanswered once staff reply', () => {
    const answered = query({ replies: [reply()] });
    expect(hasStaffReply(answered)).toBe(true);
    expect(isUnanswered(answered)).toBe(false);
  });

  it('a resolved query is never unanswered, reply or not', () => {
    expect(isUnanswered(query({ status: 'resolved', replies: [] }))).toBe(false);
  });
});

describe('countQueries', () => {
  it('counts each status, plus the two derived readings', () => {
    const counts = countQueries([
      query({ status: 'open' }),
      query({ status: 'assigned', replies: [reply()] }),
      query({ status: 'assigned' }),
      query({ status: 'resolved', replies: [reply()] }),
    ]);

    expect(counts).toEqual({
      total: 4,
      open: 1,
      assigned: 2,
      resolved: 1,
      outstanding: 3,
      unanswered: 2,
    });
  });

  it('counts an empty list as zeroes rather than throwing', () => {
    expect(countQueries([])).toEqual({
      total: 0,
      open: 0,
      assigned: 0,
      resolved: 0,
      outstanding: 0,
      unanswered: 0,
    });
  });
});

describe('outstandingByCategory', () => {
  it('counts only what is still open', () => {
    expect(
      outstandingByCategory([
        query({ category: 'hostel' }),
        query({ category: 'hostel' }),
        query({ category: 'mess' }),
        query({ category: 'mess', status: 'resolved' }),
      ]),
    ).toEqual({ hostel: 2, mess: 1 });
  });
});

describe('sortForDuty', () => {
  it('puts open before claimed before answered', () => {
    const sorted = sortForDuty([
      query({ query_id: 'C', status: 'resolved' }),
      query({ query_id: 'B', status: 'assigned' }),
      query({ query_id: 'A', status: 'open' }),
    ]);
    expect(sorted.map((q) => q.query_id)).toEqual(['A', 'B', 'C']);
  });

  it('within one status, the one nobody has replied to comes first', () => {
    // A query sitting with somebody who has said nothing is the one that gets
    // forgotten.
    const sorted = sortForDuty([
      query({ query_id: 'answered', status: 'assigned', replies: [reply()] }),
      query({ query_id: 'silent', status: 'assigned' }),
    ]);
    expect(sorted.map((q) => q.query_id)).toEqual(['silent', 'answered']);
  });

  it('does not mutate the list it was given', () => {
    const rows = [query({ query_id: 'A', status: 'resolved' }), query({ query_id: 'B' })];
    sortForDuty(rows);
    expect(rows.map((q) => q.query_id)).toEqual(['A', 'B']);
  });
});

describe('latestReply', () => {
  it('returns the last thing anybody said', () => {
    const rows = [reply({ body: 'first' }), reply({ body: 'second' })];
    expect(latestReply(query({ replies: rows }))?.body).toBe('second');
  });

  it('returns null when nobody has', () => {
    expect(latestReply(query())).toBeNull();
  });
});

describe('formatQueryTime', () => {
  it('reads a naive backend timestamp as UTC rather than local', () => {
    // `datetime.utcnow()` serialises with no offset, and ECMAScript reads that as
    // local time — which puts every row 5½ hours out in India.
    const naive = formatQueryTime('2026-08-20T09:00:00');
    const explicit = formatQueryTime('2026-08-20T09:00:00Z');
    expect(naive).toBe(explicit);
  });

  it('leaves a timestamp that already carries an offset alone', () => {
    expect(formatQueryTime('2026-08-20T09:00:00+05:30')).not.toBe(
      formatQueryTime('2026-08-20T09:00:00Z'),
    );
  });

  it('returns the raw text rather than "Invalid Date"', () => {
    expect(formatQueryTime('not a date')).toBe('not a date');
    expect(formatQueryTime(null)).toBe('');
    expect(formatQueryTime(undefined)).toBe('');
  });
});

describe('askerLine and targetLabel', () => {
  it('names the asker and their house', () => {
    expect(askerLine(query())).toBe('Meera R · Ganga');
  });

  it('falls back to the participant id when there is no name on file', () => {
    expect(askerLine(query({ participant_name: null, participant_house: null }))).toBe(
      'DS23F1000042',
    );
  });

  it('resolves a target through the name map', () => {
    expect(targetLabel(query(), { GANGA: 'Ganga Block' })).toBe('Ganga Block');
  });

  it('shows the raw id rather than nothing when the map has no name', () => {
    expect(targetLabel(query(), {})).toBe('GANGA');
  });

  it('says "Fest-wide" for a general query rather than printing an empty pill', () => {
    expect(targetLabel(query({ category: 'general', target_id: null }))).toBe('Fest-wide');
  });
});
