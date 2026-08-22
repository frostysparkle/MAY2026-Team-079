import type { BackendTeamMember, ParticipantRecord } from '@/api/types';
import {
  exportHostelRoster,
  exportMessRoster,
  exportParticipants,
  exportStaffDirectory,
} from './analyticsExport';

/**
 * These four functions end in a Blob download, which jsdom does not implement, so
 * `downloadCsv` is mocked and the CSV text it was handed is asserted instead. That
 * text is the whole contract: the header row and the flattening are what could
 * silently drift from the shape being exported.
 */
const downloadCsv = vi.hoisted(() => vi.fn<(name: string, csv: string) => void>());

vi.mock('@/lib/csv', async () => {
  const actual = await vi.importActual<typeof import('@/lib/csv')>('@/lib/csv');
  return { ...actual, downloadCsv };
});

beforeEach(() => downloadCsv.mockClear());

/** The filename and the CSV body of the one call made. */
function lastExport(): { name: string; header: string; rows: string[] } {
  expect(downloadCsv).toHaveBeenCalledTimes(1);
  const [name, csv] = downloadCsv.mock.calls[0];
  const [header, ...rows] = csv.split('\n');
  return { name, header, rows };
}

describe('exportMessRoster', () => {
  it('names the file after the hall and carries the phone column', () => {
    exportMessRoster('MESS01', {
      allotted_participants: [
        {
          participant_id: 'DS1',
          name: 'Meera',
          email: 'm@ds.study.iitm.ac.in',
          phone: '9000000000',
        },
      ],
    });
    const { name, header, rows } = lastExport();
    expect(name).toBe('mess-MESS01-allotted.csv');
    expect(header).toBe('participant_id,name,email,phone');
    expect(rows[0]).toContain('Meera');
  });
});

describe('exportHostelRoster', () => {
  it('carries the room rather than the phone, which is what a warden needs', () => {
    exportHostelRoster('HS01', {
      allotted_participants: [
        { participant_id: 'DS1', name: 'Meera', email: 'm@ds.study.iitm.ac.in', room: 'B-204' },
      ],
    });
    const { name, header, rows } = lastExport();
    expect(name).toBe('hostel-HS01-allotted.csv');
    expect(header).toBe('participant_id,name,email,room');
    expect(rows[0]).toContain('B-204');
  });
});

describe('exportParticipants', () => {
  const record: ParticipantRecord = {
    participant_id: 'DS23F1000001',
    email: 'meera@ds.study.iitm.ac.in',
    profile: { full_name: 'Meera', house: 'wayanad', phone: '9000000000' },
    mess: { mess_id: 'MESS01' },
    accommodation: { hostel_id: 'HS01', room: 'B-204', registered: true },
    event_count: 3,
    workshop_count: 1,
  };

  it('flattens the nested record into spreadsheet columns', () => {
    exportParticipants([record]);
    const { name, header, rows } = lastExport();
    expect(name).toBe('participants.csv');
    expect(header).toBe(
      'participant_id,email,name,house,gender,phone,program,course_stage,mess_preference,mess_id,hostel_id,room,accommodation_registered,events,workshops',
    );
    expect(rows[0]).toContain('Meera');
    expect(rows[0]).toContain('B-204');
    expect(rows[0]).toContain('yes');
  });

  it('renders an empty profile as blanks rather than "undefined"', () => {
    // `profile` is `{}` between registration and PATCH /profile/complete, so this
    // is the common case for a new signup, not an edge case.
    exportParticipants([{ ...record, profile: {}, mess: undefined, accommodation: undefined }]);
    const { rows } = lastExport();
    expect(rows[0]).not.toContain('undefined');
    expect(rows[0]).toContain('no');
  });
});

describe('exportStaffDirectory', () => {
  const member: BackendTeamMember = {
    paradox_id: 'BT1',
    email: 'head@paradox.in',
    role: 'super_admin',
    department: 'technical',
    designation: 'Fest Director',
    admin_id: 'abc123',
  };

  it('reduces admin_id to a yes/no, since the ObjectId means nothing in a sheet', () => {
    exportStaffDirectory([member]);
    const { name, header, rows } = lastExport();
    expect(name).toBe('staff-accounts.csv');
    expect(header).toBe('paradox_id,email,role,department,designation,linked_to_participant');
    expect(rows[0]).toContain('yes');
    expect(rows[0]).not.toContain('abc123');
  });

  it('reports an unlinked account as no', () => {
    exportStaffDirectory([{ ...member, admin_id: null }]);
    expect(lastExport().rows[0]).toContain('no');
  });
});
