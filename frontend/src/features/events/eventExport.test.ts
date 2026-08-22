import type { Event, EventParticipant, EventParticipationResponse } from '@/api/types';
import { exportEventDetails, exportEventRoster, toEventDetailCsvRows } from './eventExport';
import {
  eventRegistrants,
  registrantsByCohort,
  registrantsByHouse,
  teamSplit,
} from './eventRoster';

/**
 * Both exports end in a Blob download, which jsdom does not implement, so
 * `downloadCsv` is mocked and the text it was handed is asserted instead. That text
 * is the whole contract: the header row, the derived columns, and the "not readable"
 * wording are what could silently drift from what the API actually returns.
 */
const downloadCsv = vi.hoisted(() => vi.fn<(name: string, csv: string) => void>());

vi.mock('@/lib/csv', async () => {
  const actual = await vi.importActual<typeof import('@/lib/csv')>('@/lib/csv');
  return { ...actual, downloadCsv };
});

beforeEach(() => downloadCsv.mockClear());

function lastExport(): { name: string; header: string; rows: string[]; csv: string } {
  expect(downloadCsv).toHaveBeenCalledTimes(1);
  const [name, csv] = downloadCsv.mock.calls[0];
  const [header, ...rows] = csv.split('\n');
  return { name, header, rows, csv };
}

const REGISTRANTS: EventParticipant[] = [
  {
    participant_id: 'DS23F3001726',
    name: 'Meera',
    email: 'meera@ds.study.iitm.ac.in',
    phone: '9000000000',
    house: 'Wayanad',
    team_id: 'TE_MX_1',
    team_role: 'leader',
  },
  {
    participant_id: 'AE24F1000042',
    name: null,
    email: 'anon@ae.study.iitm.ac.in',
    phone: null,
    house: null,
    team_id: null,
    team_role: null,
  },
];

const EVENT: Event = {
  event_id: 'EV01',
  event_type: 'cultural',
  name: 'Battle of Bands',
  description: 'Live sets, four rounds.',
  team: { min: 3, max: 6, house: true, allow_single_registration: false },
  open: true,
  prize_money: [{ position: 'Winner', amount: 10000 }],
  registration: { start_time: '2026-05-17T10:00', end_time: '2026-06-01T23:59', capacity: '200' },
  schedule: [
    {
      name: 'Prelims',
      start_time: '2026-06-11T10:00',
      end_time: '2026-06-11T13:00',
      venue: 'KV Ground',
    },
  ],
  registration_fields: [],
  event_team: [{ user_id: 'STAFF1', role: 'event_head' }],
} as unknown as Event;

describe('eventRegistrants', () => {
  it('reads programme and entry cohort out of the roll number', () => {
    expect(eventRegistrants(REGISTRANTS)).toMatchObject([
      { participantId: 'DS23F3001726', programme: 'Data Science', entryYear: 2023 },
      { participantId: 'AE24F1000042', programme: 'Aeronautics & Space Tech', entryYear: 2024 },
    ]);
  });

  it('sorts named registrants first and leaves unnamed ones at the end', () => {
    const names = eventRegistrants(REGISTRANTS).map((r) => r.name);
    expect(names).toEqual(['Meera', null]);
  });

  it('counts an unplaceable house as Unknown and never ranks it first', () => {
    const rows = registrantsByHouse(eventRegistrants(REGISTRANTS));
    expect(rows[rows.length - 1]).toEqual({ key: 'Unknown', label: 'Unknown', value: 1 });
  });

  it('orders cohorts oldest first, as a year axis', () => {
    const rows = registrantsByCohort(eventRegistrants(REGISTRANTS));
    expect(rows.map((r) => r.key)).toEqual(['2023', '2024']);
  });

  it('splits teamed from solo entries and counts distinct teams', () => {
    expect(teamSplit(eventRegistrants(REGISTRANTS))).toEqual({ teamed: 1, solo: 1, teams: 1 });
  });
});

describe('exportEventRoster', () => {
  it('carries the derived programme and cohort beside the API fields', () => {
    exportEventRoster('EV01', REGISTRANTS);
    const { name, header, rows } = lastExport();
    expect(name).toBe('event-EV01-registrations.csv');
    expect(header).toBe(
      'participant_id,name,email,phone,house,programme,entry_cohort,team_id,team_role',
    );
    expect(rows.join('\n')).toContain('Data Science,2023,TE_MX_1,leader');
  });

  it('writes blanks, not placeholders, for fields the roster does not carry', () => {
    exportEventRoster('EV01', [REGISTRANTS[1]]);
    const { rows } = lastExport();
    expect(rows[0]).toBe(
      'AE24F1000042,,anon@ae.study.iitm.ac.in,,,Aeronautics & Space Tech,2024,,',
    );
  });
});

describe('toEventDetailCsvRows', () => {
  const participation: EventParticipationResponse = {
    count: 2,
    participants: REGISTRANTS,
    event_team: [{ user_id: 'STAFF1', role: 'event_head', name: 'Ravi', phone: '9876543210' }],
    total_daily_scans: 5,
  };

  function valueOf(rows: ReturnType<typeof toEventDetailCsvRows>, field: string) {
    return rows.find((row) => row.field === field)?.value;
  }

  it('reports the event, its rules, its rounds, and its team', () => {
    const rows = toEventDetailCsvRows(EVENT, participation);
    expect(valueOf(rows, 'Name')).toBe('Battle of Bands');
    expect(valueOf(rows, 'Registration')).toBe('open');
    expect(valueOf(rows, 'House-only teams')).toBe('yes');
    expect(valueOf(rows, 'Single entries allowed')).toBe('no');
    expect(valueOf(rows, 'Round 1')).toContain('Prelims');
    expect(valueOf(rows, 'Round 1')).toContain('KV Ground');
    expect(valueOf(rows, 'Winner')).toBe('₹10,000');
    expect(valueOf(rows, 'Event Head')).toBe('Ravi · 9876543210');
  });

  it('measures the published capacity against today’s scans', () => {
    const rows = toEventDetailCsvRows(EVENT, participation);
    expect(valueOf(rows, 'Published capacity')).toBe('200');
    expect(valueOf(rows, 'Registered')).toBe('2');
    expect(valueOf(rows, 'Unique scans today')).toBe('5');
    expect(valueOf(rows, 'Entries left today')).toBe('195');
  });

  it('says a UHC caller cannot read attendance rather than writing a zero', () => {
    // A UHC caller's response has no `total_daily_scans` key at all, which is why
    // the module tests for the key rather than for a null.
    const rows = toEventDetailCsvRows(EVENT, {
      count: participation.count,
      event_team: participation.event_team,
    });
    expect(valueOf(rows, 'Unique scans today')).toBe('not readable from this account');
    expect(valueOf(rows, 'Entries left today')).toBe('not readable from this account');
  });

  it('falls back to the event record’s team when no roster was loaded', () => {
    const rows = toEventDetailCsvRows(EVENT);
    expect(valueOf(rows, 'Event Head')).toBe('STAFF1');
    expect(valueOf(rows, 'Registered')).toBeUndefined();
  });
});

describe('exportEventDetails', () => {
  it('names the file after the event and writes the long-form header', () => {
    exportEventDetails(EVENT);
    const { name, header } = lastExport();
    expect(name).toBe('event-EV01-details.csv');
    expect(header).toBe('section,field,value');
  });
});
