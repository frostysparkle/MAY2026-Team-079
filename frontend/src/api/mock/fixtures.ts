import type {
  Participant,
  EventItem,
  Contact,
  SupportQuery,
  MessMenuItem,
  HostelAllocation,
  Announcement,
  MealPlan,
  OnboardingChoice,
} from '@/api/types';
import type { Role } from '@/config/constants';

/**
 * Seed data for the mock API. Includes one account per role so the UI can be
 * exercised end-to-end without a backend. The first Super Admin mirrors the
 * "seeded directly in the DB" one-time setup from the PRD.
 */
export function seedParticipants(): Participant[] {
  return [
    {
      id: 'p_superadmin',
      email: 'superadmin@ds.study.iitm.ac.in',
      fullName: 'Priya Menon',
      role: 'super_admin',
      age: 28,
      gender: 'female',
      phone: '9000000001',
      country: 'India',
      state: 'Tamil Nadu',
      city: 'Chennai',
      program: 'working_professional',
      courseStage: 'degree',
      courseStageOther: null,
      photoUrl: null,
      profileComplete: true,
      createdAt: '2026-07-01T09:00:00+05:30',
    },
    {
      id: 'p_admin',
      email: 'admin@es.study.iitm.ac.in',
      fullName: 'Rahul Nair',
      role: 'admin',
      age: 25,
      gender: 'male',
      phone: '9000000002',
      country: 'India',
      state: 'Kerala',
      city: 'Kochi',
      program: 'dual_degree',
      courseStage: 'degree',
      courseStageOther: null,
      photoUrl: null,
      profileComplete: true,
      createdAt: '2026-07-02T10:00:00+05:30',
    },
    {
      id: 'p_organizer',
      email: 'organizer@ee.study.iitm.ac.in',
      fullName: 'Sana Iqbal',
      role: 'organizer',
      age: 22,
      gender: 'female',
      phone: '9000000003',
      country: 'India',
      state: 'Karnataka',
      city: 'Bengaluru',
      program: 'standalone_degree',
      courseStage: 'diploma',
      courseStageOther: null,
      photoUrl: null,
      profileComplete: true,
      createdAt: '2026-07-03T11:00:00+05:30',
    },
    {
      id: 'p_participant',
      email: 'student@mg.study.iitm.ac.in',
      fullName: 'Arjun Verma',
      role: 'participant',
      age: 20,
      gender: 'male',
      phone: '9000000004',
      country: 'India',
      state: 'Maharashtra',
      city: 'Pune',
      program: 'standalone_degree',
      courseStage: 'foundational',
      courseStageOther: null,
      photoUrl: null,
      profileComplete: true,
      createdAt: '2026-07-04T12:00:00+05:30',
    },
  ];
}

/** Seed events for the mock API (Epic 1). One is a draft to exercise admin views. */
export function seedEvents(): EventItem[] {
  return [
    {
      id: 'e_keynote',
      title: 'Paradox Opening Keynote',
      venue: 'CLT Auditorium',
      eventDate: '2026-08-14',
      startTime: '10:00',
      endTime: '11:30',
      capacity: 800,
      instructions:
        'Carry your digital ID. Doors close 10 minutes before start. No outside food.',
      status: 'published',
      createdAt: '2026-07-10T09:00:00+05:30',
    },
    {
      id: 'e_hackathon',
      title: 'Overnight Hackathon',
      venue: 'CSE Lab Block',
      eventDate: '2026-08-15',
      startTime: '18:00',
      endTime: '06:00',
      capacity: 150,
      instructions: 'Bring your own laptop and charger. Team size 2-4. ID scan at entry and exit.',
      status: 'published',
      createdAt: '2026-07-11T09:00:00+05:30',
    },
    {
      id: 'e_draft_concert',
      title: 'Pro Night (Unannounced)',
      venue: 'Open Air Theatre',
      eventDate: '2026-08-16',
      startTime: '19:00',
      endTime: '22:00',
      capacity: 2000,
      instructions: 'Lineup to be announced. Wristband mandatory.',
      status: 'draft',
      createdAt: '2026-07-12T09:00:00+05:30',
    },
  ];
}

/** Seed contact directory + emergency contacts for the mock (Epic 6). */
export function seedContacts(): Contact[] {
  return [
    {
      id: 'c_security',
      name: 'Campus Security Control Room',
      role: 'Security',
      category: 'security',
      phone: '9100000000',
      email: null,
      isEmergency: true,
    },
    {
      id: 'c_medical',
      name: 'Institute Health Centre',
      role: 'Medical Emergency',
      category: 'general',
      phone: '9100000111',
      email: 'health@iitm.ac.in',
      isEmergency: true,
    },
    {
      id: 'c_hostel',
      name: 'Hostel Office Desk',
      role: 'Accommodation',
      category: 'hostel',
      phone: '9100000222',
      email: 'hostel@paradox.example',
      isEmergency: false,
    },
    {
      id: 'c_mess',
      name: 'Mess Supervisor',
      role: 'Mess',
      category: 'mess',
      phone: '9100000333',
      email: null,
      isEmergency: false,
    },
  ];
}

/** Seed the mess menu for the mock (Epic 4). */
export function seedMessMenu(): MessMenuItem[] {
  return [
    {
      id: 'm_bf',
      location: 'Main Mess',
      meal: 'breakfast',
      items: 'Idli, Vada, Sambar, Bread, Tea/Coffee',
      startTime: '07:30',
      endTime: '09:30',
    },
    {
      id: 'm_lunch',
      location: 'Main Mess',
      meal: 'lunch',
      items: 'Rice, Dal, Paneer Curry, Chapati, Curd, Salad',
      startTime: '12:30',
      endTime: '14:30',
    },
    {
      id: 'm_dinner',
      location: 'Main Mess',
      meal: 'dinner',
      items: 'Fried Rice, Gobi Manchurian, Roti, Dal Tadka',
      startTime: '19:30',
      endTime: '21:30',
    },
  ];
}

/** Seed a hostel allocation for the mock participant (Epic 5). */
export function seedHostelAllocations(): HostelAllocation[] {
  return [
    {
      id: 'h_participant',
      participantId: 'p_participant',
      hostelBlock: 'Block A',
      room: '214',
      instructions: 'Check in at the Block A office. Carry your digital ID.',
      coordinator: 'Mr. Rao · 9100000222',
      checkedIn: false,
      checkedInAt: null,
    },
  ];
}

/** Seed announcements for the mock (Epic 8). */
export function seedAnnouncements(): Announcement[] {
  return [
    {
      id: 'a_welcome',
      title: 'Welcome to Paradox!',
      body: 'Gates open at 9 AM. Keep your digital ID handy at every checkpoint.',
      audience: 'all_participants',
      eventId: null,
      senderName: 'Core Team',
      createdAt: '2026-08-13T18:00:00+05:30',
    },
    {
      id: 'a_hostel',
      title: 'Hostel water supply notice',
      body: 'Water supply in all blocks will be interrupted 2–4 PM today for maintenance.',
      audience: 'hostel_residents',
      eventId: null,
      senderName: 'Accommodation Team',
      createdAt: '2026-08-14T09:00:00+05:30',
    },
  ];
}

/** Seed mess meal plans for the mock (Epic 10). */
export function seedMealPlans(): MealPlan[] {
  return [
    {
      id: 'plan_full',
      name: 'Full Plan (3 meals)',
      description: 'Breakfast, lunch, and dinner for the fest.',
      amount: 1500,
      currency: 'INR',
      active: true,
    },
    {
      id: 'plan_dinner',
      name: 'Dinner Only',
      description: 'Dinner access for the fest.',
      amount: 700,
      currency: 'INR',
      active: true,
    },
  ];
}

/** Seed one query for the mock participant so the tracking view isn't empty. */
export function seedQueries(): SupportQuery[] {
  return [
    {
      id: 'q_seed',
      participantId: 'p_participant',
      category: 'hostel',
      description: 'AC in my room is not working.',
      status: 'in_progress',
      assignedTeam: 'hostel',
      createdAt: '2026-07-14T08:00:00+05:30',
      updatedAt: '2026-07-14T10:00:00+05:30',
    },
  ];
}


/**
 * Test-harness accounts for the mock — a faithful mirror of the backend
 * `scripts/seed_test_data.py` matrix so the dev account switcher behaves the
 * same offline (spec: student-experience-redesign, Req 10).
 */
export interface TestAccountSeed {
  participant: Participant;
  label: string;
  onboarding: {
    accommodationChoice: OnboardingChoice | null;
    messChoice: OnboardingChoice | null;
    messPlanId: string | null;
  };
  hostelPaid: boolean;
  messEligible: boolean;
  allocation?: { hostelBlock: string; room: string };
  registrations: string[]; // seed event ids
  payments: { kind: 'hostel' | 'mess'; status: 'created' | 'paid'; amount: number; planName?: string }[];
}

const FULL_PLAN_ID = 'plan_full';

function testParticipant(local: string, role: Role, profileComplete: boolean): Participant {
  return {
    id: `p_${local}`,
    email: `${local}@ds.study.iitm.ac.in`,
    fullName: profileComplete ? `${local[0].toUpperCase()}${local.slice(1)} Test` : '',
    role,
    age: profileComplete ? 20 : null,
    gender: profileComplete ? 'other' : null,
    phone: profileComplete ? '9000000000' : null,
    country: profileComplete ? 'India' : null,
    state: profileComplete ? 'Tamil Nadu' : null,
    city: profileComplete ? 'Chennai' : null,
    program: profileComplete ? 'standalone_degree' : null,
    courseStage: profileComplete ? 'degree' : null,
    courseStageOther: null,
    photoUrl: null,
    profileComplete,
    createdAt: '2026-07-20T09:00:00+05:30',
  };
}

export function seedTestAccounts(): TestAccountSeed[] {
  const none = { accommodationChoice: null, messChoice: null, messPlanId: null };
  return [
    {
      participant: testParticipant('newbie', 'participant', false),
      label: 'New — no profile',
      onboarding: none,
      hostelPaid: false,
      messEligible: false,
      registrations: [],
      payments: [],
    },
    {
      participant: testParticipant('profileonly', 'participant', true),
      label: 'Profile done — no bookings',
      onboarding: none,
      hostelPaid: false,
      messEligible: false,
      registrations: [],
      payments: [],
    },
    {
      participant: testParticipant('hosteler', 'participant', true),
      label: 'Accommodation booked + paid',
      onboarding: { accommodationChoice: 'yes', messChoice: 'no', messPlanId: null },
      hostelPaid: true,
      messEligible: false,
      allocation: { hostelBlock: 'Block A', room: '214' },
      registrations: [],
      payments: [{ kind: 'hostel', status: 'paid', amount: 2000 }],
    },
    {
      participant: testParticipant('hostelunpaid', 'participant', true),
      label: 'Accommodation — payment pending',
      onboarding: { accommodationChoice: 'yes', messChoice: 'no', messPlanId: null },
      hostelPaid: false,
      messEligible: false,
      registrations: [],
      payments: [{ kind: 'hostel', status: 'created', amount: 2000 }],
    },
    {
      participant: testParticipant('messie', 'participant', true),
      label: 'Mess booked + paid',
      onboarding: { accommodationChoice: 'no', messChoice: 'yes', messPlanId: FULL_PLAN_ID },
      hostelPaid: false,
      messEligible: true,
      registrations: [],
      payments: [{ kind: 'mess', status: 'paid', amount: 1500, planName: 'Full Plan (3 meals)' }],
    },
    {
      participant: testParticipant('fullstack', 'participant', true),
      label: 'Fully onboarded (all paid + events)',
      onboarding: { accommodationChoice: 'yes', messChoice: 'yes', messPlanId: FULL_PLAN_ID },
      hostelPaid: true,
      messEligible: true,
      allocation: { hostelBlock: 'Block C', room: '007' },
      registrations: ['e_keynote', 'e_hackathon'],
      payments: [
        { kind: 'hostel', status: 'paid', amount: 2000 },
        { kind: 'mess', status: 'paid', amount: 1500, planName: 'Full Plan (3 meals)' },
      ],
    },
    {
      participant: testParticipant('eventfan', 'participant', true),
      label: 'Registered for events',
      onboarding: { accommodationChoice: 'no', messChoice: 'no', messPlanId: null },
      hostelPaid: false,
      messEligible: false,
      registrations: ['e_keynote'],
      payments: [],
    },
    {
      participant: testParticipant('paidpending', 'participant', true),
      label: 'One paid, one pending',
      onboarding: { accommodationChoice: 'yes', messChoice: 'yes', messPlanId: FULL_PLAN_ID },
      hostelPaid: true,
      messEligible: false,
      allocation: { hostelBlock: 'Block A', room: '118' },
      registrations: [],
      payments: [
        { kind: 'hostel', status: 'paid', amount: 2000 },
        { kind: 'mess', status: 'created', amount: 1500, planName: 'Full Plan (3 meals)' },
      ],
    },
    {
      participant: testParticipant('volunteer', 'organizer', true),
      label: 'Organizer / volunteer',
      onboarding: none,
      hostelPaid: false,
      messEligible: false,
      registrations: [],
      payments: [],
    },
    {
      participant: testParticipant('warden', 'admin', true),
      label: 'Admin',
      onboarding: none,
      hostelPaid: false,
      messEligible: false,
      registrations: [],
      payments: [],
    },
  ];
}
