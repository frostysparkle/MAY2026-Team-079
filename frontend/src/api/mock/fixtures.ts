import type { Participant, EventItem, Contact, SupportQuery } from '@/api/types';

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
