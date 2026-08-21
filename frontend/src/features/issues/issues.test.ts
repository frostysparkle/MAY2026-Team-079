import { describe, expect, it } from 'vitest';
import type {
  Hostel,
  Issue,
  Mess,
  MyHostelResponse,
  MyMessResponse,
  StaffIssue,
} from '@/api/types';
import {
  BODY_MAX,
  EMPTY_DRAFT,
  ISSUE_CATEGORIES,
  MAX_OPEN_PER_FACILITY,
  SUBJECT_MAX,
  atReportLimit,
  categoryLabel,
  countIssues,
  draftSmsBody,
  draftToRequest,
  facilityKey,
  findFacility,
  formatIssueTime,
  issueSmsBody,
  latestNote,
  latestUpdate,
  outstandingFor,
  reportableFacilities,
  reporterLine,
  sortForDuty,
  statusLabel,
  statusTone,
  validateDraft,
  type ReportDraft,
  type ReportableFacility,
} from './issues';

/**
 * Story 5.4's rules. Every one of these mirrors something
 * `backend/routers/issues.py` enforces, so the assertions below double as a
 * record of what the two sides have agreed — if a test here starts failing
 * because the backend changed, this file is what gets corrected, not the backend.
 */

const BLOCK: ReportableFacility = {
  type: 'hostel',
  id: 'H12',
  name: 'Ganga Block',
  room: '101',
};
const HALL: ReportableFacility = { type: 'mess', id: 'M3', name: 'Hall C', room: null };

function issue(overrides: Partial<Issue> = {}): Issue {
  return {
    issue_id: 'ISS17555000001234',
    facility_type: 'hostel',
    facility_id: 'H12',
    category: 'water',
    subject: 'No hot water',
    body: 'Cold since 6am.',
    room: '101',
    status: 'open',
    created_at: '2026-08-20T06:30:00',
    updated_at: '2026-08-20T06:30:00',
    updates: [],
    ...overrides,
  };
}

function draft(overrides: Partial<ReportDraft> = {}): ReportDraft {
  return {
    facilityKey: facilityKey(BLOCK),
    category: 'water',
    subject: 'No hot water',
    body: 'Cold since 6am.',
    room: '',
    ...overrides,
  };
}

describe('categories', () => {
  it('offers each facility only the categories the backend accepts for it', () => {
    expect(ISSUE_CATEGORIES.hostel.map((c) => c.value)).toEqual([
      'water',
      'electricity',
      'cleanliness',
      'furniture',
      'internet',
      'safety',
      'noise',
      'other',
    ]);
    expect(ISSUE_CATEGORIES.mess.map((c) => c.value)).toEqual([
      'food_quality',
      'hygiene',
      'service',
      'timing',
      'dietary',
      'other',
    ]);
  });

  it('never offers a mess category on a hostel, which the backend would 400', () => {
    const hostelValues = ISSUE_CATEGORIES.hostel.map((c) => c.value);
    expect(hostelValues).not.toContain('food_quality');
    expect(ISSUE_CATEGORIES.mess.map((c) => c.value)).not.toContain('water');
  });

  it('labels a stored category, and de-underscores one it does not know', () => {
    expect(categoryLabel('mess', 'food_quality')).toBe('Food quality');
    expect(categoryLabel('hostel', 'water')).toBe('Water');
    // A category added to the backend before this file catches up still reads as
    // words rather than vanishing from a report somebody filed.
    expect(categoryLabel('hostel', 'pest_control')).toBe('Pest control');
    expect(categoryLabel('hostel', '')).toBe('Uncategorised');
  });
});

describe('statuses', () => {
  it('labels the three statuses in plain words', () => {
    expect(statusLabel('open')).toBe('Open');
    expect(statusLabel('in_progress')).toBe('Being worked on');
    expect(statusLabel('resolved')).toBe('Resolved');
  });

  it('paints an unanswered report as a warning, not a danger', () => {
    // Every report starts here; red would make a working queue look broken.
    expect(statusTone('open')).toBe('warning');
    expect(statusTone('in_progress')).toBe('info');
    expect(statusTone('resolved')).toBe('success');
  });

  it('falls back rather than throwing on a status it does not know', () => {
    expect(statusLabel('wontfix')).toBe('wontfix');
    expect(statusTone('wontfix')).toBe('neutral');
  });
});

describe('reportableFacilities', () => {
  const myHostel = (over: Partial<MyHostelResponse> = {}): MyHostelResponse => ({
    assigned_hostel: 'H12',
    room: '101',
    logged_in: false,
    registered: true,
    volunteers: [],
    ...over,
  });

  const myMess = (over: Partial<MyMessResponse> = {}): MyMessResponse => ({
    allotted_mess: 'M3',
    mess_details: { mess_id: 'M3', name: 'Hall C', capacity: 400 } as Mess,
    slots: [],
    ...over,
  });

  it('offers the block and hall the participant is actually placed in', () => {
    // No catalogue passed, so the block falls back to its id while the hall gets
    // its name from the `mess_details` document `my_mess` returns whole.
    const facilities = reportableFacilities({ hostel: myHostel(), mess: myMess() });
    expect(facilities).toEqual([
      { type: 'hostel', id: 'H12', name: 'H12', room: '101' },
      { type: 'mess', id: 'M3', name: 'Hall C', room: null },
    ]);
  });

  it('names the block from the catalogue when it has one', () => {
    const facilities = reportableFacilities({
      hostel: myHostel(),
      mess: null,
      hostels: [{ hostel_id: 'H12', name: 'Ganga Block' } as Hostel],
    });
    expect(facilities[0].name).toBe('Ganga Block');
  });

  it('falls back to the id rather than dropping a facility when the catalogue failed', () => {
    // A report against `H12` is filed correctly whether or not the client knows
    // the block is called Ganga, so losing the name must not lose the option.
    const facilities = reportableFacilities({ hostel: myHostel(), mess: null, hostels: [] });
    expect(facilities).toHaveLength(1);
    expect(facilities[0].name).toBe('H12');
  });

  it('offers nothing to a participant with no placement at all', () => {
    expect(
      reportableFacilities({
        hostel: myHostel({ assigned_hostel: null, room: null, registered: false }),
        mess: myMess({ allotted_mess: null, mess_details: null }),
      }),
    ).toEqual([]);
  });

  it('offers only the hall to somebody who eats in but sleeps elsewhere', () => {
    const facilities = reportableFacilities({
      hostel: myHostel({ assigned_hostel: null, room: null }),
      mess: myMess(),
    });
    expect(facilities.map((f) => f.type)).toEqual(['mess']);
  });

  it('never puts a room number on a mess report', () => {
    const facilities = reportableFacilities({ hostel: null, mess: myMess() });
    expect(facilities[0].room).toBeNull();
  });

  it('round-trips a facility through its key', () => {
    expect(facilityKey(BLOCK)).toBe('hostel:H12');
    expect(findFacility([BLOCK, HALL], 'mess:M3')).toEqual(HALL);
    expect(findFacility([BLOCK, HALL], 'hostel:NOPE')).toBeNull();
  });
});

describe('validateDraft', () => {
  const facilities = [BLOCK, HALL];

  it('accepts a complete draft', () => {
    expect(validateDraft(draft(), facilities)).toEqual({});
  });

  it('requires a facility that is actually on offer', () => {
    expect(validateDraft(draft({ facilityKey: '' }), facilities).facilityKey).toBeDefined();
    expect(
      validateDraft(draft({ facilityKey: 'hostel:SOMEWHERE_ELSE' }), facilities).facilityKey,
    ).toBeDefined();
  });

  it('rejects a category belonging to the other facility type', () => {
    // The backend 400s on this; discovering it after typing a report is worse.
    const errors = validateDraft(
      draft({ facilityKey: facilityKey(HALL), category: 'water' }),
      facilities,
    );
    expect(errors.category).toMatch(/does not apply/i);
  });

  it('distinguishes an unchosen category from a wrong one', () => {
    expect(validateDraft(draft({ category: '' }), facilities).category).toMatch(/Choose/);
  });

  it('mirrors the backend length limits exactly, and counts trimmed', () => {
    expect(validateDraft(draft({ subject: 'ab' }), facilities).subject).toBeDefined();
    expect(validateDraft(draft({ subject: '   a   ' }), facilities).subject).toBeDefined();
    expect(validateDraft(draft({ subject: 'abc' }), facilities).subject).toBeUndefined();
    expect(
      validateDraft(draft({ subject: 'x'.repeat(SUBJECT_MAX + 1) }), facilities).subject,
    ).toBeDefined();
    expect(validateDraft(draft({ body: 'ab' }), facilities).body).toBeDefined();
    expect(validateDraft(draft({ body: 'x'.repeat(BODY_MAX + 1) }), facilities).body).toBeDefined();
  });

  it('does not require a room, because the backend fills one in', () => {
    expect(validateDraft(draft({ room: '' }), facilities).room).toBeUndefined();
  });

  it('rejects the empty draft on every required field', () => {
    const errors = validateDraft(EMPTY_DRAFT, facilities);
    expect(Object.keys(errors).sort()).toEqual(['body', 'facilityKey', 'subject']);
  });
});

describe('draftToRequest', () => {
  const facilities = [BLOCK, HALL];

  it('sends the facility split back into the two fields the API wants', () => {
    expect(draftToRequest(draft(), facilities)).toEqual({
      facility_type: 'hostel',
      facility_id: 'H12',
      category: 'water',
      subject: 'No hot water',
      body: 'Cold since 6am.',
    });
  });

  it('omits the room entirely rather than sending an empty one', () => {
    // Sending `''` would talk the backend out of the allotted room it already has.
    const body = draftToRequest(draft({ room: '   ' }), facilities);
    expect(body && 'room' in body).toBe(false);
  });

  it('sends a stated room, trimmed', () => {
    expect(draftToRequest(draft({ room: '  2nd floor bathroom ' }), facilities)?.room).toBe(
      '2nd floor bathroom',
    );
  });

  it('trims the subject and body', () => {
    const body = draftToRequest(
      draft({ subject: '  Leak  ', body: '  Under the sink. ' }),
      facilities,
    );
    expect(body?.subject).toBe('Leak');
    expect(body?.body).toBe('Under the sink.');
  });

  it('refuses to build a request the backend would reject', () => {
    expect(draftToRequest(draft({ subject: '' }), facilities)).toBeNull();
    expect(draftToRequest(draft({ facilityKey: 'nope' }), facilities)).toBeNull();
  });
});

describe('the outstanding-report cap', () => {
  it('counts only unresolved reports, and only for that facility', () => {
    const issues = [
      issue({ issue_id: 'a', status: 'open' }),
      issue({ issue_id: 'b', status: 'in_progress' }),
      issue({ issue_id: 'c', status: 'resolved' }),
      issue({ issue_id: 'd', status: 'open', facility_type: 'mess', facility_id: 'M3' }),
    ];
    expect(outstandingFor(issues, BLOCK)).toBe(2);
    expect(outstandingFor(issues, HALL)).toBe(1);
  });

  it('blocks at the backend limit, and a resolution frees a slot', () => {
    const open = Array.from({ length: MAX_OPEN_PER_FACILITY }, (_, i) =>
      issue({ issue_id: `i${i}`, status: 'open' }),
    );
    expect(atReportLimit(open, BLOCK)).toBe(true);
    expect(atReportLimit([...open.slice(1), issue({ status: 'resolved' })], BLOCK)).toBe(false);
    expect(atReportLimit(open, HALL)).toBe(false);
  });
});

describe('countIssues', () => {
  it('splits by status and totals what still needs acting on', () => {
    expect(
      countIssues([
        issue({ status: 'open' }),
        issue({ status: 'open' }),
        issue({ status: 'in_progress' }),
        issue({ status: 'resolved' }),
      ]),
    ).toEqual({ total: 4, open: 2, in_progress: 1, resolved: 1, outstanding: 3 });
  });

  it('is all zeroes for an empty list', () => {
    expect(countIssues([])).toEqual({
      total: 0,
      open: 0,
      in_progress: 0,
      resolved: 0,
      outstanding: 0,
    });
  });
});

describe('sortForDuty', () => {
  it('puts unanswered reports first regardless of age', () => {
    // The API sorts newest first, which is right for the reporter's own list and
    // wrong for a queue.
    const sorted = sortForDuty([
      issue({ issue_id: 'new-resolved', status: 'resolved' }),
      issue({ issue_id: 'old-open', status: 'open' }),
      issue({ issue_id: 'working', status: 'in_progress' }),
    ]);
    expect(sorted.map((i) => i.issue_id)).toEqual(['old-open', 'working', 'new-resolved']);
  });

  it('keeps the API order within a status, so a poll does not reshuffle the list', () => {
    const sorted = sortForDuty([
      issue({ issue_id: 'first', status: 'open' }),
      issue({ issue_id: 'second', status: 'open' }),
      issue({ issue_id: 'third', status: 'open' }),
    ]);
    expect(sorted.map((i) => i.issue_id)).toEqual(['first', 'second', 'third']);
  });

  it('does not mutate the list it was given', () => {
    const input = [issue({ status: 'resolved' }), issue({ status: 'open' })];
    sortForDuty(input);
    expect(input[0].status).toBe('resolved');
  });
});

describe('reading a report history', () => {
  const history = issue({
    status: 'resolved',
    updates: [
      { at: '2026-08-20T07:00:00', status: 'in_progress', note: 'Plumber called.' },
      { at: '2026-08-20T09:00:00', status: 'resolved', note: null },
    ],
  });

  it('latestUpdate is the last thing that happened', () => {
    expect(latestUpdate(history)?.status).toBe('resolved');
    expect(latestUpdate(issue())).toBeNull();
  });

  it('latestNote skips a bare status change, because that is not an answer', () => {
    // Showing "Resolved" with nothing under it where a participant expected to
    // read what was done is worse than showing the last real sentence.
    expect(latestNote(history)?.note).toBe('Plumber called.');
    expect(latestNote(issue())).toBeNull();
  });
});

describe('formatIssueTime', () => {
  it('reads the backend naive timestamp as UTC rather than local', () => {
    // `datetime.utcnow()` serialises with no offset, and ECMAScript reads that as
    // local — which put every report 5½ hours out in India before this existed.
    const withZ = formatIssueTime('2026-08-20T06:30:00Z');
    const naive = formatIssueTime('2026-08-20T06:30:00');
    expect(naive).toBe(withZ);
  });

  it('honours an offset the backend does send', () => {
    expect(formatIssueTime('2026-08-20T06:30:00+00:00')).toBe(
      formatIssueTime('2026-08-20T06:30:00Z'),
    );
  });

  it('returns the raw value rather than "Invalid Date" for anything unparseable', () => {
    expect(formatIssueTime('not a date')).toBe('not a date');
    expect(formatIssueTime('')).toBe('');
    expect(formatIssueTime(null)).toBe('');
    expect(formatIssueTime(undefined)).toBe('');
  });
});

describe('the phone hand-off', () => {
  it('leads a filed report with its reference so the volunteer can find it', () => {
    expect(issueSmsBody(issue(), 'Ganga Block')).toBe(
      'Paradox issue ISS17555000001234\nGanga Block (room 101)\nWater: No hot water\nCold since 6am.',
    );
  });

  it('omits the room when there is none', () => {
    expect(issueSmsBody(issue({ room: null }), 'Hall C')).toContain('Hall C\n');
  });

  it('falls back to the allotted room for a draft that has not been filed', () => {
    expect(draftSmsBody(draft({ room: '' }), BLOCK)).toContain('Ganga Block (room 101)');
    expect(draftSmsBody(draft({ room: 'Terrace' }), BLOCK)).toContain('Ganga Block (room Terrace)');
    expect(draftSmsBody(draft({ facilityKey: facilityKey(HALL) }), HALL)).toContain('Hall C\n');
  });
});

describe('reporterLine', () => {
  const staffIssue = (over: Partial<StaffIssue['reporter']> = {}): StaffIssue => ({
    ...issue(),
    reporter: {
      participant_id: 'DS23F1000042',
      name: 'Anita Rao',
      phone: '9876500011',
      room: '101',
      ...over,
    },
  });

  it('reads as one line', () => {
    expect(reporterLine(staffIssue())).toBe('Anita Rao · 9876500011 · room 101');
  });

  it('falls back to the participant id when no profile was completed', () => {
    expect(reporterLine(staffIssue({ name: null }))).toBe('DS23F1000042 · 9876500011 · room 101');
  });

  it('drops the parts that are absent rather than printing empty separators', () => {
    expect(reporterLine(staffIssue({ phone: null, room: null }))).toBe('Anita Rao');
    expect(reporterLine(staffIssue({ name: '  ', phone: '  ', room: '  ' }))).toBe('DS23F1000042');
  });
});
