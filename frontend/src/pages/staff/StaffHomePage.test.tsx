import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { Event, EventParticipationResponse, StaffLoginResponse } from '@/api/types';
import { useAuthStore } from '@/stores/authStore';

/**
 * Event staff accounts carry the event's own category as `department`
 * (`departmentForEvent`). `isDomainAdminFor` is that department compared to
 * `event_type`, so a Last1Standing volunteer in `sports` used to be shown
 * "Participation & Reports" for every other sports event — Sprintsaga, Kampus
 * Run, Inner Engineering, and the rest — none of which they run. Event Heads
 * were later withheld from that panel; members and volunteers were not. These
 * pin that the panel stays off for every event-team role, and on for a UHC
 * officer or Super Admin who is not staffing an event.
 */

const listMess = vi.fn();
const listHostels = vi.fn();
const listEvents = vi.fn();
const listWorkshops = vi.fn();
const eventParticipation = vi.fn();
const listAnnouncements = vi.fn();

vi.mock('@/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api')>();
  return {
    ...actual,
    api: {
      ...actual.api,
      listMess: () => listMess(),
      listHostels: () => listHostels(),
      listEvents: () => listEvents(),
      listWorkshops: () => listWorkshops(),
      eventParticipation: (...args: unknown[]) => eventParticipation(...args),
      listAnnouncements: (...args: unknown[]) => listAnnouncements(...args),
    },
  };
});

const { default: StaffHomePage } = await import('./StaffHomePage');

const STAFF_ID = 'ADSP22';

const OTHER_SPORTS = [
  'Sprintsaga',
  'Kampus Run',
  'IPL Auction Showdown 4.0',
  'Inner Engineering 4 Days Youth Program',
] as const;

function makeEvent(partial: Partial<Event> & Pick<Event, 'event_id' | 'name'>): Event {
  return {
    event_type: 'sports',
    description: '',
    team: { min: 1, max: 1, house_vs_house_event: false, allow_single_registration: true },
    prize_money: [],
    registration: {},
    schedule: [],
    registration_fields: [],
    event_team: [],
    ...partial,
  };
}

function sportsCatalogue(roleOnLast1Standing?: 'event_head' | 'member' | 'volunteer'): Event[] {
  const last1Standing = makeEvent({
    event_id: '22',
    name: 'Last1Standing',
    event_team: roleOnLast1Standing ? [{ user_id: STAFF_ID, role: roleOnLast1Standing }] : [],
  });
  return [
    last1Standing,
    ...OTHER_SPORTS.map((name, i) => makeEvent({ event_id: String(70 + i), name })),
  ];
}

function emptyParticipation(): EventParticipationResponse {
  return { count: 0, participants: [], event_team: [] };
}

function signIn(overrides: Partial<StaffLoginResponse> = {}) {
  useAuthStore.getState().setStaffSession({
    id: STAFF_ID,
    email: 'last1standing@paradox.in',
    access_token: 't',
    token_type: 'staff',
    role: 'other',
    department: 'sports',
    designation: 'Volunteer',
    ...overrides,
  });
}

function renderPage() {
  return render(
    <MemoryRouter>
      <StaffHomePage />
    </MemoryRouter>,
  );
}

const reportsHeading = () => screen.queryByRole('heading', { name: 'Participation & Reports' });

describe('StaffHomePage — Participation & Reports', () => {
  beforeEach(() => {
    localStorage.clear();
    useAuthStore.getState().clear();
    listMess.mockResolvedValue([]);
    listHostels.mockResolvedValue([]);
    listWorkshops.mockResolvedValue([]);
    eventParticipation.mockResolvedValue(emptyParticipation());
    listAnnouncements.mockResolvedValue([]);
  });

  it.each([
    { role: 'volunteer' as const, designation: 'Volunteer' },
    { role: 'member' as const, designation: 'Event Member' },
    { role: 'event_head' as const, designation: 'Event Head' },
  ])(
    'does not list other events for a Last1Standing $designation',
    async ({ role, designation }) => {
      signIn({ designation });
      listEvents.mockResolvedValue(sportsCatalogue(role));
      renderPage();

      await screen.findByRole('heading', { name: 'Dashboard' });
      // Their own event still has a duty section; the oversight list of every
      // other sports event is what must not appear.
      expect(await screen.findByRole('heading', { name: 'Participants' })).toBeInTheDocument();
      expect(reportsHeading()).not.toBeInTheDocument();
      for (const name of OTHER_SPORTS) {
        expect(screen.queryByText(name)).not.toBeInTheDocument();
      }
    },
  );

  it('still lists events for a UHC officer who is not on an event team', async () => {
    signIn({
      role: 'staff',
      department: 'uhc',
      designation: 'UHC Secretary',
      email: 'wayanad-sec@ds.study.iitm.ac.in',
    });
    listEvents.mockResolvedValue(sportsCatalogue());
    renderPage();

    expect(
      await screen.findByRole('heading', { name: 'Participation & Reports' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Last1Standing')).toBeInTheDocument();
    expect(screen.getByText('Sprintsaga')).toBeInTheDocument();
  });

  it('still lists matching events for a domain admin who is not on an event team', async () => {
    signIn({ role: 'admin', department: 'sports', designation: 'Sports Admin' });
    listEvents.mockResolvedValue(sportsCatalogue());
    renderPage();

    expect(
      await screen.findByRole('heading', { name: 'Participation & Reports' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Sprintsaga')).toBeInTheDocument();
  });
});
