import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { Event, EventParticipationResponse } from '@/api/types';
import { path, ROUTES } from '@/config/routes';
import { writeEventRegistration } from '@/features/events/eventExtras';

/**
 * Story 3.2 is only delivered if an organiser can *read* the entries left on the
 * screen they already open to run an event, so these assert the rendered page.
 * The arithmetic itself is covered by `features/events/eventCapacity.test.ts`.
 *
 * `participation.total_daily_scans` now counts distinct participants rather than
 * scan rows, so there is one attendance reading and the page needs no second
 * source to correct it.
 */

const eventParticipation = vi.fn<() => Promise<EventParticipationResponse>>();
const listEvents = vi.fn<() => Promise<Event[]>>();

vi.mock('@/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api')>();
  return {
    ...actual,
    api: {
      eventParticipation: () => eventParticipation(),
      listEvents: () => listEvents(),
    },
  };
});

const { default: EventParticipationPage } = await import('./EventParticipationPage');

const EVENT_ID = 'hack-2026';

function makeEvent(registration: Event['registration']): Event {
  return {
    event_id: EVENT_ID,
    event_type: 'technical',
    name: 'Hackathon 2026',
    description: '',
    team: { min: 1, max: 1, house_vs_house_event: false, allow_single_registration: true },
    prize_money: [],
    registration,
    schedule: [],
    registration_fields: [],
    event_team: [],
  };
}

function participation(count: number, scansToday?: number): EventParticipationResponse {
  return {
    count,
    participants: Array.from({ length: count }, (_, i) => ({
      participant_id: `P${i}`,
      name: `Person ${i}`,
      email: `p${i}@example.com`,
      phone: null,
      house: null,
      team_id: null,
      team_role: null,
      photo: null,
    })),
    event_team: [],
    ...(scansToday === undefined ? {} : { total_daily_scans: scansToday }),
  };
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={[path(ROUTES.eventParticipation, { eventId: EVENT_ID })]}>
      <Routes>
        <Route path={ROUTES.eventParticipation} element={<EventParticipationPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('EventParticipationPage — entries left (story 3.2)', () => {
  beforeEach(() => {
    eventParticipation.mockResolvedValue(participation(150, 142));
    listEvents.mockResolvedValue([makeEvent(writeEventRegistration({ capacity: 200 }))]);
  });

  it('subtracts today’s attendance from the published capacity', async () => {
    renderPage();
    expect(await screen.findByText('Entry capacity today')).toBeInTheDocument();
    expect(screen.getByText('Entries left')).toBeInTheDocument();
    expect(screen.getByText('58 of 200 entries left')).toBeInTheDocument();
  });

  it('names what the admitted figure counts, so it cannot be misread', async () => {
    renderPage();
    expect(await screen.findByText('58 of 200 entries left')).toBeInTheDocument();
    expect(screen.getByText('unique participants scanned in today')).toBeInTheDocument();
  });

  it('shows nothing at all for an event with no published capacity', async () => {
    listEvents.mockResolvedValue([makeEvent(writeEventRegistration({}))]);
    renderPage();
    // The roster still loads — only the capacity block is absent, because an
    // event with no declared limit has no "entries left" to report.
    const registeredHeading = await screen.findByRole('heading', { name: 'Registered' });
    expect(registeredHeading).toBeInTheDocument();
    expect(registeredHeading.parentElement).toHaveTextContent('150');
    expect(screen.queryByText('Entry capacity today')).not.toBeInTheDocument();
  });

  it('reports an over-admitted gate as zero left plus a warning', async () => {
    eventParticipation.mockResolvedValue(participation(250, 212));
    renderPage();
    expect(await screen.findByText('12 over a capacity of 200')).toBeInTheDocument();
    expect(screen.getByText('12 past the published capacity')).toBeInTheDocument();
  });

  it('flags an event with more registrations than the venue holds', async () => {
    eventParticipation.mockResolvedValue(participation(250, 10));
    renderPage();
    expect(await screen.findByText('50 more registered than the venue holds')).toBeInTheDocument();
  });

  it('leaves the figures blank rather than zero when attendance is unreadable', async () => {
    // A UHC caller's participation response carries no `total_daily_scans`.
    eventParticipation.mockResolvedValue(participation(150));
    renderPage();
    expect(await screen.findByText('Capacity 200')).toBeInTheDocument();
    expect(
      screen.getByText('Today’s attendance is not readable from this account'),
    ).toBeInTheDocument();
  });
});
