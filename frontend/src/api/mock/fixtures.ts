import type {
  EmergencyContact,
  Event,
  EventCreateRequest,
  Hostel,
  Mess,
  MessDayEntry,
  MyEventRegistration,
  Workshop,
  WorkshopCreateRequest,
} from '@/api/types';
import paradoxEvents from '@/data/paradoxEvents.json';
import paradoxHostels from '@/data/paradoxHostels.json';
import paradoxMess from '@/data/paradoxMess.json';
import paradoxWorkshops from '@/data/paradoxWorkshops.json';

/**
 * The migrated Paradox event catalogue — every event as a create-event payload,
 * byte-identical to what the "+ New Event" form submits. JSON carries no types,
 * so it is asserted to the request shape it was generated as.
 */
const PARADOX_EVENTS = paradoxEvents as unknown as EventCreateRequest[];

/** The migrated Paradox workshop programme, as create-workshop payloads. */
const PARADOX_WORKSHOPS = paradoxWorkshops as WorkshopCreateRequest[];

/** The official hostel inventory: 16 men's blocks, 6 women's, 300 beds each. */
const PARADOX_HOSTELS = paradoxHostels as Omit<Hostel, 'hostel_team'>[];
/** The official mess catalogue: Himalaya, Vindhya, and Nilgiri. */
const PARADOX_MESS = paradoxMess as Omit<Mess, 'mess_team'>[];

/**
 * The blocks the demo participants live in — one men's, one women's, so seeded
 * accommodation lines up with each participant's gender.
 */
const MENS_DEMO_HOSTEL = 'HS01';
const WOMENS_DEMO_HOSTEL = 'HS17';

/**
 * The hall the demo participants are allocated to and the one the mess volunteer
 * scans for. A hall out of the real catalogue, so nothing in the mock depends on
 * an id the seeded database does not have.
 */
const DEMO_MESS_HALL = 'MS01';

/** Internal mock participant record — a superset of what login responses expose. */
export interface MockParticipant {
  participant_id: string;
  email: string;
  password: string;
  profile: {
    full_name: string | null;
    dob: string | null;
    house: string | null;
    gender: string | null;
    phone: string | null;
    mess_preference?: string;
    country: string | null;
    state: string | null;
    city: string | null;
    address: string | null;
    emergency_contact?: EmergencyContact;
    program: string | null;
    course_stage: string | null;
  };
  photo: string | null;
  mess: { registered: boolean; mess_id: string | null; entries: MessDayEntry[] };
  accommodation: {
    registered: boolean;
    hostel_id: string | null;
    room: string | null;
    logged_in: boolean;
  };
  events: MyEventRegistration[];
  workshops: {
    slot_id: string;
    booking_type: 'pre-registered' | 'on-spot';
    workshop_id: string;
    attended: boolean;
  }[];
  created_at: string;
}

export interface MockBackendTeamMember {
  paradox_id: string;
  email: string;
  password: string;
  role: string;
  department: string;
  designation: string;
  admin_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface MockAuditLog {
  actor_id: string;
  action: string;
  target_id?: string | null;
  details?: Record<string, unknown>;
  timestamp: string;
}

/** A row of the `event_logs` collection: one attendance scan. */
export interface MockEventLog {
  event_id: string;
  participant_id: string;
  scanned_by: string;
  /** `YYYY-MM-DD`, the field the real scan endpoint dedupes on. */
  day: string;
  timestamp: string;
}

/** A row of the `workshop_logs` collection: a booking or a turnstile scan. */
export interface MockWorkshopLog {
  workshop_id: string;
  action: 'registration' | 'attendance';
  /** Attendance only: how the attendee got in. */
  scan_type?: 'pre-registered' | 'on-spot';
  participant_id: string;
  /** Attendance only: who scanned them. */
  scanned_by?: string;
  timestamp: string;
}

function freshMessEntries(): MessDayEntry[] {
  return Array.from({ length: 5 }, () => ({
    breakfast: { logged: false },
    lunch: { logged: false },
    dinner: { logged: false },
  }));
}

export function seedParticipants(): MockParticipant[] {
  return [
    {
      participant_id: 'DS23F1000001',
      email: 'participant@ds.study.iitm.ac.in',
      password: 'password123',
      profile: {
        full_name: 'Arjun Verma',
        dob: '2005-04-12',
        house: 'House 1',
        gender: 'male',
        phone: '9000000004',
        mess_preference: 'veg',
        country: 'India',
        state: 'Maharashtra',
        city: 'Pune',
        address: '221B, MG Road',
        program: 'DS',
        course_stage: 'foundational',
      },
      photo: null,
      mess: { registered: true, mess_id: DEMO_MESS_HALL, entries: freshMessEntries() },
      accommodation: {
        registered: true,
        hostel_id: MENS_DEMO_HOSTEL,
        room: '100',
        logged_in: false,
      },
      events: [],
      workshops: [],
      created_at: '2026-07-04T12:00:00+05:30',
    },
    {
      participant_id: 'DS23F1000002',
      email: 'newuser@ds.study.iitm.ac.in',
      password: 'password123',
      profile: {
        full_name: null,
        dob: null,
        house: null,
        gender: null,
        phone: null,
        country: null,
        state: null,
        city: null,
        address: null,
        program: null,
        course_stage: null,
      },
      photo: null,
      mess: { registered: false, mess_id: null, entries: freshMessEntries() },
      accommodation: { registered: false, hostel_id: null, room: null, logged_in: false },
      events: [],
      workshops: [],
      created_at: '2026-07-05T09:00:00+05:30',
    },
    {
      participant_id: 'ES23F1000003',
      email: 'wayanad.student@es.study.iitm.ac.in',
      password: 'password123',
      profile: {
        full_name: 'Meera Pillai',
        dob: '2004-11-02',
        house: 'wayanad',
        gender: 'female',
        phone: '9000000005',
        mess_preference: 'non_veg',
        country: 'India',
        state: 'Kerala',
        city: 'Kochi',
        address: '12, Marine Drive',
        program: 'ES',
        course_stage: 'diploma',
      },
      photo: null,
      mess: { registered: true, mess_id: DEMO_MESS_HALL, entries: freshMessEntries() },
      accommodation: {
        registered: true,
        hostel_id: WOMENS_DEMO_HOSTEL,
        room: '101',
        logged_in: true,
      },
      events: [],
      workshops: [],
      created_at: '2026-07-05T10:00:00+05:30',
    },
  ];
}

export function seedBackendTeams(): MockBackendTeamMember[] {
  return [
    {
      paradox_id: 'BT1000000001',
      email: 'superadmin@paradox.dev',
      password: 'password123',
      role: 'super_admin',
      department: 'technical',
      designation: 'Fest Director',
      admin_id: null,
      created_at: '2026-07-01T09:00:00+05:30',
      updated_at: '2026-07-01T09:00:00+05:30',
    },
    {
      paradox_id: 'BT1000000002',
      email: 'eventhead@paradox.dev',
      password: 'password123',
      role: 'staff',
      department: 'technical',
      designation: 'Event Head',
      admin_id: null,
      created_at: '2026-07-01T09:05:00+05:30',
      updated_at: '2026-07-01T09:05:00+05:30',
    },
    {
      paradox_id: 'BT1000000003',
      email: 'messvolunteer@paradox.dev',
      password: 'password123',
      role: 'staff',
      department: 'hospitality',
      designation: 'Mess Volunteer',
      admin_id: null,
      created_at: '2026-07-01T09:10:00+05:30',
      updated_at: '2026-07-01T09:10:00+05:30',
    },
    {
      paradox_id: 'BT1000000004',
      email: 'hostelvolunteer@paradox.dev',
      password: 'password123',
      role: 'staff',
      department: 'hospitality',
      designation: 'Hostel Volunteer',
      admin_id: null,
      created_at: '2026-07-01T09:15:00+05:30',
      updated_at: '2026-07-01T09:15:00+05:30',
    },
    {
      paradox_id: 'BT1000000005',
      email: 'workshopvolunteer@paradox.dev',
      password: 'password123',
      role: 'staff',
      department: 'workshops',
      designation: 'Workshop Volunteer',
      admin_id: null,
      created_at: '2026-07-01T09:20:00+05:30',
      updated_at: '2026-07-01T09:20:00+05:30',
    },
    {
      // Hyphenated email — the backend's UHC house-parsing convention.
      paradox_id: 'BT1000000006',
      email: 'wayanad-sec@ds.study.iitm.ac.in',
      password: 'password123',
      role: 'staff',
      department: 'uhc',
      designation: 'UHC Coordinator',
      admin_id: null,
      created_at: '2026-07-01T09:25:00+05:30',
      updated_at: '2026-07-01T09:25:00+05:30',
    },
  ];
}

/**
 * The mess collection, stored exactly as `POST /mess` stores a hall created from
 * the Super Admin dashboard.
 *
 * The catalogue lives in `src/data/paradoxMess.json` — the same dataset
 * `backend/seed_mess.py` writes to Mongo, so the dashboard shows the identical
 * halls under the identical ids whether it runs against this mock or the real
 * database. The arrangement the hostel and event catalogues already use.
 *
 * The mess volunteer is assigned to the demo hall, exactly as
 * `POST /mess/{id}/team` would store it. Every other hall opens with no team, the
 * same as a freshly created one.
 */
export function seedMess(): Mess[] {
  return PARADOX_MESS.map((hall) => ({
    ...hall,
    mess_team:
      hall.mess_id === DEMO_MESS_HALL
        ? [
            {
              user_id: 'BT1000000003',
              role: 'other' as const,
              name: 'Mess Volunteer',
              phone: '9000000010',
              logging: true,
            },
          ]
        : [],
  }));
}

/**
 * The hostel volunteer scans one men's and one women's block, so both the entry
 * and the exit flow have a hostel to demo. Assigned exactly as
 * `POST /hostels/{id}/team` would store it.
 */
const HOSTEL_VOLUNTEER_BLOCKS = [MENS_DEMO_HOSTEL, WOMENS_DEMO_HOSTEL];

/**
 * The hostel collection: the official 22-block catalogue, stored exactly as
 * `POST /hostels` stores a block created from the Super Admin dashboard.
 *
 * The inventory lives in `src/data/paradoxHostels.json` — the same dataset
 * `backend/seed.py` writes to Mongo, so the mock and the real database hold the
 * same blocks under the same ids. Occupancy is not stored: it is derived from
 * who is allocated where, which is what `hostelStatistics` reports.
 */
export function seedHostels(): Hostel[] {
  return PARADOX_HOSTELS.map((hostel) => ({
    ...hostel,
    hostel_team: HOSTEL_VOLUNTEER_BLOCKS.includes(hostel.hostel_id)
      ? [
          {
            user_id: 'BT1000000004',
            role: 'other' as const,
            name: 'Hostel Volunteer',
            phone: '9000000011',
            logging: true,
          },
        ]
      : [],
  }));
}

/**
 * Event heads, as a Super Admin would have assigned them from the dashboard
 * (`POST /events/{id}/team`). Seeded for a couple of events so the staff event
 * screens have something real to show.
 */
const SEEDED_EVENT_TEAMS: Record<string, Event['event_team']> = {
  // A solo event and a team event, so both staff flows have real data.
  '22': [{ user_id: 'BT1000000002', role: 'event_head' }],
  '74': [{ user_id: 'BT1000000002', role: 'event_head' }],
};

/**
 * The events collection: the full Paradox catalogue, stored exactly as
 * `POST /events` stores an event created from the Super Admin dashboard —
 * `open: true` and an empty team until someone is assigned.
 *
 * The content lives in `src/data/paradoxEvents.json`, the one dataset the
 * backend seeder posts to the live API, so the mock and the real database hold
 * the same events.
 */
export function seedEvents(): Event[] {
  return PARADOX_EVENTS.map((payload) => ({
    ...payload,
    poster: payload.poster ?? '',
    open: true,
    prize_money: payload.prize_money ?? [],
    schedule: payload.schedule ?? [],
    registration_fields: payload.registration_fields ?? [],
    event_team: SEEDED_EVENT_TEAMS[payload.event_id] ?? [],
  }));
}

/**
 * Dev/test workshops.
 *
 * Ids follow the flyer convention (`workshop-NN` resolves
 * `/images/workshops/workshop-NN.avif`), and `slot_id` is a real day/shift pair
 * so the public filters and the backend's one-booking-per-slot rule both have
 * something meaningful to work against. `workshop-04` deliberately shares
 * `2026-06-12-morning` with `workshop-03` so the clash path is exercised.
 */
/**
 * The migrated Paradox workshop programme — every workshop as a create-workshop
 * payload, byte-identical to what the "+ New workshop" form submits. JSON
 * carries no types, so it is asserted to the request shape it was generated as.
 *
 * `workshop-04` is assigned to the same volunteer as the rest; the seat counts
 * start at zero so booking flows have room to run.
 */
export function seedWorkshops(): Workshop[] {
  const volunteer = [{ user_id: 'BT1000000005', role: 'workshop_volunteer', attendance: true }];
  return PARADOX_WORKSHOPS.map((w) => ({
    ...w,
    registration_count: 0,
    participant_count: 0,
    workshop_team: volunteer,
  }));
}

/**
 * The audit trail, as `backend/logger.py::log_audit` would have written it.
 *
 * Deliberately spans all four domains an admin can drill into — an event, a
 * workshop, a mess hall, and a hostel block — and includes the two record types
 * that exist nowhere else in the system: `MESS_SCAN`, which carries the meal and
 * the day, and the `HOSTEL_ENTRY` / `HOSTEL_EXIT` pair, which is the only place
 * entry and exit are distinguishable.
 *
 * The demo volunteers are the actors on the scan entries, matching who is
 * actually assigned to scan for `MS01`, `HS01`, and `HS17`.
 */
export function seedAuditLogs(): MockAuditLog[] {
  return [
    /* ---- events ---- */
    {
      actor_id: 'BT1000000001',
      action: 'CREATE_EVENT',
      target_id: '22',
      details: {},
      timestamp: '2026-07-15T10:00:00+05:30',
    },
    {
      actor_id: 'BT1000000001',
      action: 'ASSIGN_EVENT_TEAM',
      target_id: '22',
      details: { assigned_user: 'BT1000000002', role: 'event_head' },
      timestamp: '2026-07-15T10:05:00+05:30',
    },
    {
      actor_id: 'DS23F1000001',
      action: 'EVENT_REGISTER',
      target_id: '22',
      details: {},
      timestamp: '2026-07-16T18:20:00+05:30',
    },
    {
      actor_id: 'BT1000000001',
      action: 'UPDATE_EVENT',
      target_id: '22',
      details: { fields_updated: ['description', 'schedule'] },
      timestamp: '2026-07-17T09:12:00+05:30',
    },
    /* ---- workshops ---- */
    {
      actor_id: 'BT1000000001',
      action: 'CREATE_WORKSHOP',
      target_id: 'workshop-02',
      details: { capacity: 60 },
      timestamp: '2026-07-15T11:00:00+05:30',
    },
    {
      actor_id: 'BT1000000001',
      action: 'UPDATE_WORKSHOP',
      target_id: 'workshop-02',
      details: {},
      timestamp: '2026-07-18T14:30:00+05:30',
    },
    /* ---- mess ---- */
    {
      actor_id: 'BT1000000001',
      action: 'CREATE_MESS',
      target_id: 'MS01',
      details: { capacity: 450 },
      timestamp: '2026-07-15T12:00:00+05:30',
    },
    {
      actor_id: 'BT1000000001',
      action: 'ASSIGN_MESS_TEAM',
      target_id: 'MS01',
      details: { team_user_id: 'BT1000000003', role: 'other' },
      timestamp: '2026-07-15T12:05:00+05:30',
    },
    // Meal scans: the slot and the day are recorded nowhere else.
    {
      actor_id: 'BT1000000003',
      action: 'MESS_SCAN',
      target_id: 'MS01',
      details: { participant_id: 'DS23F1000001', slot: 'breakfast', day: 1 },
      timestamp: '2026-08-10T08:14:00+05:30',
    },
    {
      actor_id: 'BT1000000003',
      action: 'MESS_SCAN',
      target_id: 'MS01',
      details: { participant_id: 'ES23F1000003', slot: 'breakfast', day: 1 },
      timestamp: '2026-08-10T08:31:00+05:30',
    },
    {
      actor_id: 'BT1000000003',
      action: 'MESS_SCAN',
      target_id: 'MS01',
      details: { participant_id: 'DS23F1000001', slot: 'lunch', day: 1 },
      timestamp: '2026-08-10T13:02:00+05:30',
    },
    /* ---- hostels ---- */
    {
      actor_id: 'BT1000000001',
      action: 'CREATE_HOSTEL',
      target_id: 'HS01',
      details: { capacity: 300 },
      timestamp: '2026-07-15T13:00:00+05:30',
    },
    {
      actor_id: 'BT1000000001',
      action: 'ASSIGN_HOSTEL_TEAM',
      target_id: 'HS01',
      details: { team_user_id: 'BT1000000004', role: 'other' },
      timestamp: '2026-07-15T13:05:00+05:30',
    },
    // The only entry/exit pair in the system. Same participant, in then out.
    {
      actor_id: 'BT1000000004',
      action: 'HOSTEL_ENTRY',
      target_id: 'HS01',
      details: { participant_id: 'DS23F1000001' },
      timestamp: '2026-08-10T07:40:00+05:30',
    },
    {
      actor_id: 'BT1000000004',
      action: 'HOSTEL_EXIT',
      target_id: 'HS01',
      details: { participant_id: 'DS23F1000001' },
      timestamp: '2026-08-10T09:05:00+05:30',
    },
    {
      actor_id: 'BT1000000004',
      action: 'HOSTEL_ENTRY',
      target_id: 'HS17',
      details: { participant_id: 'ES23F1000003' },
      timestamp: '2026-08-10T07:52:00+05:30',
    },
    /* ---- not tied to any one entity ---- */
    {
      actor_id: 'BT1000000001',
      action: 'ALLOCATE_HOSTELS',
      target_id: null,
      details: { allocated_count: 2 },
      timestamp: '2026-07-20T16:00:00+05:30',
    },
  ];
}

/**
 * Event attendance scans — the `event_logs` collection.
 *
 * Keyed by the readable `event_id` here, where the backend keys by the event's
 * ObjectId; `GET /events/{id}/logs` translates, so both return the same rows for
 * the same event. Deduped per participant/scanner/day, matching the real scan
 * endpoint's uniqueness rule.
 */
export function seedEventLogs(): MockEventLog[] {
  return [
    {
      event_id: '22',
      participant_id: 'DS23F1000001',
      scanned_by: 'BT1000000002',
      day: '2026-08-10',
      timestamp: '2026-08-10T10:02:00+05:30',
    },
    {
      event_id: '22',
      participant_id: 'ES23F1000003',
      scanned_by: 'BT1000000002',
      day: '2026-08-10',
      timestamp: '2026-08-10T10:07:00+05:30',
    },
    {
      event_id: '22',
      participant_id: 'DS23F1000001',
      scanned_by: 'BT1000000002',
      day: '2026-08-11',
      timestamp: '2026-08-11T09:58:00+05:30',
    },
  ];
}

/**
 * Workshop registration and attendance rows — the `workshop_logs` collection,
 * returned by `GET /workshops/{id}/logs`.
 *
 * `action` separates a booking from a turnstile scan, and `scan_type` records
 * whether an attendee was pre-registered or walked up on the day.
 */
export function seedWorkshopLogs(): MockWorkshopLog[] {
  return [
    {
      workshop_id: 'workshop-02',
      action: 'registration',
      participant_id: 'DS23F1000001',
      timestamp: '2026-07-20T11:15:00+05:30',
    },
    {
      workshop_id: 'workshop-02',
      action: 'attendance',
      scan_type: 'pre-registered',
      participant_id: 'DS23F1000001',
      scanned_by: 'BT1000000005',
      timestamp: '2026-08-12T09:34:00+05:30',
    },
    {
      workshop_id: 'workshop-02',
      action: 'attendance',
      scan_type: 'on-spot',
      participant_id: 'ES23F1000003',
      scanned_by: 'BT1000000005',
      timestamp: '2026-08-12T09:41:00+05:30',
    },
  ];
}
