import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type {
  Event,
  EventUpdateRequest,
  Hostel,
  MessageResponse,
  Mess,
  StaffLoginResponse,
} from '@/api/types';
import { useAuthStore } from '@/stores/authStore';
import { readAnnouncements } from '@/features/announcements/announcements';

/**
 * Story 8.1's send half. A notice is only delivered if it *leaves the device*, so
 * these assert the body that goes to `PUT /events/{event_id}` — that it carries
 * the whole registration map, that it disturbs no other event field, and that the
 * chosen audience survives the trip.
 */

const listEvents = vi.fn<() => Promise<Event[]>>();
const listHostels = vi.fn<() => Promise<Hostel[]>>();
const listMess = vi.fn<() => Promise<Mess[]>>();
const updateEvent = vi.fn<(id: string, req: EventUpdateRequest) => Promise<MessageResponse>>();

vi.mock('@/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api')>();
  return {
    ...actual,
    api: {
      listEvents: () => listEvents(),
      listHostels: () => listHostels(),
      listMess: () => listMess(),
      updateEvent: (id: string, req: EventUpdateRequest) => updateEvent(id, req),
    },
  };
});

const { default: AdminAnnouncementsPage } = await import('./AdminAnnouncementsPage');

function makeEvent(overrides: Partial<Event> = {}): Event {
  return {
    event_id: 'hackathon',
    event_type: 'technical',
    name: 'Hackathon',
    description: 'Build something.',
    team: { min: 1, max: 4, house: false, allow_single_registration: true },
    open: true,
    prize_money: [],
    // A realistic map: the notice must not disturb any of this.
    registration: {
      start_time: '1 Jun',
      end_time: '9 Jun',
      capacity: '200',
      faqs: '[{"q":"Fee?","a":"None"}]',
    } as never,
    schedule: [],
    registration_fields: [],
    event_team: [],
    ...overrides,
  };
}

const HOSTEL: Hostel = {
  hostel_id: 'H12',
  name: 'Ganga Block',
  capacity: 300,
  gender: 'male',
};

const HALL: Mess = { mess_id: 'M3', name: 'Hall C', capacity: 500, preference: 'veg' };

function signIn(role = 'super_admin') {
  const session: StaffLoginResponse = {
    id: 'BT1000000001',
    email: 'ops@paradox.in',
    access_token: 't',
    token_type: 'staff',
    role,
    department: 'technicals',
    designation: 'Ops Head',
  };
  useAuthStore.getState().setStaffSession(session);
}

function renderPage() {
  return render(
    <MemoryRouter>
      <AdminAnnouncementsPage />
    </MemoryRouter>,
  );
}

/** Fill in the composer and send. */
async function compose(
  user: ReturnType<typeof userEvent.setup>,
  { title, body, audience }: { title: string; body: string; audience?: string },
) {
  await user.type(await screen.findByLabelText(/Headline/), title);
  await user.type(screen.getByLabelText(/Message/), body);
  if (audience) {
    await user.selectOptions(screen.getByLabelText(/Who is told/), audience);
  }
  await user.click(screen.getByRole('button', { name: /Send announcement/ }));
}

describe('AdminAnnouncementsPage', () => {
  beforeEach(() => {
    localStorage.clear();
    useAuthStore.getState().clear();
    signIn();
    listEvents.mockResolvedValue([makeEvent()]);
    listHostels.mockResolvedValue([HOSTEL]);
    listMess.mockResolvedValue([HALL]);
    updateEvent.mockResolvedValue({ message: 'Event updated successfully' });
  });

  it('states on screen that a notice is not private', async () => {
    renderPage();
    // `registration` is in PUBLIC_EVENT_FIELDS, so anonymous callers can read it.
    expect(await screen.findByText(/Announcements are public/)).toBeInTheDocument();
  });

  it('sends a notice, and stores it in the event\u2019s registration map', async () => {
    const user = userEvent.setup();
    renderPage();
    await compose(user, { title: 'Round 2 moved', body: 'Now at CLT.' });

    await waitFor(() => expect(updateEvent).toHaveBeenCalled());
    const [eventId, payload] = updateEvent.mock.calls[0];
    expect(eventId).toBe('hackathon');

    const stored = readAnnouncements(payload.registration as Event['registration'], 'hackathon');
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({
      title: 'Round 2 moved',
      body: 'Now at CLT.',
      audience: { kind: 'everyone' },
      severity: 'info',
      postedBy: 'Ops Head',
    });
  });

  it('sends only the registration map, so no other event field can be disturbed', async () => {
    const user = userEvent.setup();
    renderPage();
    await compose(user, { title: 'T', body: 'B' });

    await waitFor(() => expect(updateEvent).toHaveBeenCalled());
    // `update_event` only $sets the fields a request carries.
    expect(Object.keys(updateEvent.mock.calls[0][1])).toEqual(['registration']);
  });

  it('preserves the rest of the registration map exactly', async () => {
    const user = userEvent.setup();
    renderPage();
    await compose(user, { title: 'T', body: 'B' });

    await waitFor(() => expect(updateEvent).toHaveBeenCalled());
    const map = updateEvent.mock.calls[0][1].registration as unknown as Record<string, string>;
    expect(map.start_time).toBe('1 Jun');
    expect(map.end_time).toBe('9 Jun');
    expect(map.capacity).toBe('200');
    expect(map.faqs).toBe('[{"q":"Fee?","a":"None"}]');
  });

  it('carries the chosen audience, which is how Story 8.2 narrows delivery', async () => {
    const user = userEvent.setup();
    renderPage();
    await compose(user, {
      title: 'Block water outage',
      body: 'Supply back by 6pm.',
      audience: 'hostel:H12',
    });

    await waitFor(() => expect(updateEvent).toHaveBeenCalled());
    const stored = readAnnouncements(
      updateEvent.mock.calls[0][1].registration as Event['registration'],
      'hackathon',
    );
    expect(stored[0].audience).toEqual({ kind: 'hostel', id: 'H12' });
  });

  it('offers audiences built from the live catalogue, not a fixed list', async () => {
    renderPage();
    const select = await screen.findByLabelText(/Who is told/);
    expect(select).toHaveTextContent('Residents of — Ganga Block');
    expect(select).toHaveTextContent('Diners at — Hall C');
    expect(select).toHaveTextContent('Registered for — Hackathon');
    expect(select).toHaveTextContent('Block team — Ganga Block');
    // Houses come from config, because profile.house has no endpoint to enumerate.
    expect(select).toHaveTextContent('House — Nilgiri');
  });

  it('refuses to send without a headline or a message', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: /Send announcement/ }));

    expect(await screen.findByText(/Give the announcement a headline/)).toBeInTheDocument();
    expect(updateEvent).not.toHaveBeenCalled();
  });

  it('reports a failed send rather than clearing the form as though it worked', async () => {
    const { ApiClientError } = await import('@/api');
    updateEvent.mockRejectedValue(new ApiClientError(403, 'Only Super Admins can edit this event'));
    const user = userEvent.setup();
    renderPage();
    await compose(user, { title: 'Round 2 moved', body: 'Now at CLT.' });

    expect(await screen.findByText('Only Super Admins can edit this event')).toBeInTheDocument();
    expect(screen.getByLabelText(/Headline/)).toHaveValue('Round 2 moved');
  });

  it('lists what is already on the board, and withdraws one on confirmation', async () => {
    const existing = {
      id: 'AN-old',
      title: 'Gates open at 8',
      body: 'Bring your ID.',
      audience: 'participants',
      severity: 'info',
      posted_at: '2026-06-09T09:00:00.000Z',
    };
    listEvents.mockResolvedValue([
      makeEvent({
        registration: { start_time: '1 Jun', announcements: JSON.stringify([existing]) } as never,
      }),
    ]);

    const user = userEvent.setup();
    renderPage();

    expect(await screen.findByText('Gates open at 8')).toBeInTheDocument();
    await user.click(
      screen.getByRole('button', { name: 'Withdraw announcement: Gates open at 8' }),
    );
    await user.click(screen.getByRole('button', { name: 'Withdraw' }));

    await waitFor(() => expect(updateEvent).toHaveBeenCalled());
    const map = updateEvent.mock.calls[0][1].registration as unknown as Record<string, string>;
    // The key goes entirely rather than being left as an empty array.
    expect(map).not.toHaveProperty('announcements');
    expect(map.start_time).toBe('1 Jun');
  });

  it('does not count an expired notice as standing', async () => {
    // `visibleTo` already drops this on every reading surface, so calling it
    // "standing" here would report a delivery that is not happening.
    listEvents.mockResolvedValue([
      makeEvent({
        registration: {
          start_time: '1 Jun',
          announcements: JSON.stringify([
            {
              id: 'AN-live',
              title: 'Gates open at 8',
              body: 'Bring your ID.',
              audience: 'participants',
              severity: 'info',
              posted_at: '2026-06-09T09:00:00.000Z',
            },
            {
              id: 'AN-done',
              title: 'Lunch moved to 1pm',
              body: 'Today only.',
              audience: 'participants',
              severity: 'info',
              posted_at: '2026-06-08T09:00:00.000Z',
              expires_at: '2020-01-01T00:00:00.000Z',
            },
          ]),
        } as never,
      }),
    ]);

    renderPage();

    expect(await screen.findByText('Gates open at 8')).toBeInTheDocument();
    expect(screen.getByText('1 standing')).toBeInTheDocument();
    expect(screen.getByText(/Expired — 1 notice/)).toBeInTheDocument();
  });

  it('keeps an expired notice on screen so it can still be withdrawn', async () => {
    // Withdrawing is only reachable from this list; hiding an expired row would
    // leave a dead entry in the carrier event's map with no way to remove it.
    listEvents.mockResolvedValue([
      makeEvent({
        registration: {
          start_time: '1 Jun',
          announcements: JSON.stringify([
            {
              id: 'AN-done',
              title: 'Lunch moved to 1pm',
              body: 'Today only.',
              audience: 'participants',
              severity: 'info',
              posted_at: '2026-06-08T09:00:00.000Z',
              expires_at: '2020-01-01T00:00:00.000Z',
            },
          ]),
        } as never,
      }),
    ]);

    const user = userEvent.setup();
    renderPage();

    expect(await screen.findByText('Lunch moved to 1pm')).toBeInTheDocument();
    expect(screen.getByText('0 standing')).toBeInTheDocument();
    // Not the empty state: something is still stored.
    expect(screen.queryByText('Nothing announced yet')).not.toBeInTheDocument();

    await user.click(
      screen.getByRole('button', { name: 'Withdraw announcement: Lunch moved to 1pm' }),
    );
    await user.click(screen.getByRole('button', { name: 'Withdraw' }));

    await waitFor(() => expect(updateEvent).toHaveBeenCalled());
    const map = updateEvent.mock.calls[0][1].registration as unknown as Record<string, string>;
    expect(map).not.toHaveProperty('announcements');
  });

  it('shows an empty state when nothing has been announced', async () => {
    renderPage();
    expect(await screen.findByText('Nothing announced yet')).toBeInTheDocument();
  });
});
