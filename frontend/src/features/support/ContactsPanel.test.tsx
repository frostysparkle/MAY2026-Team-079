import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { Hostel, Mess, ParticipantLoginResponse } from '@/api/types';
import { ROUTES } from '@/config/routes';
import { useAuthStore } from '@/stores/authStore';

/**
 * Story 6.5. The directory is presentation over data `GET /hostels` and
 * `GET /mess` already return to any signed-in caller, so what matters here is
 * that a participant ends up with a number they can dial — and that the
 * backend's `"N/A"` and role-word placeholders never reach the screen.
 */

const listHostels = vi.fn<() => Promise<Hostel[]>>();
const listMess = vi.fn<() => Promise<Mess[]>>();

vi.mock('@/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api')>();
  return {
    ...actual,
    api: {
      listHostels: () => listHostels(),
      listMess: () => listMess(),
    },
  };
});

const { ContactsPanel } = await import('./ContactsPanel');

const GANGA: Hostel = {
  hostel_id: 'H12',
  name: 'Ganga Block',
  capacity: 300,
  gender: 'male',
  category: "Men's block",
  coordinator: { name: 'Dr. Rao', phone: '+91 98765 43210' },
  hostel_team: [
    { user_id: 'BT1', role: 'other', name: 'Meera R', phone: '9000000002', logging: true },
    // Nameless and unreachable — the shape the backend produces for a bare record.
    { user_id: 'BT2', role: 'volunteer', name: 'volunteer', phone: 'N/A', logging: false },
  ],
};

const HALL: Mess = {
  mess_id: 'M3',
  name: 'Hall C',
  capacity: 500,
  preference: 'veg',
  cuisines: ['south_indian'],
  mess_team: [
    { user_id: 'BT3', role: 'other', name: 'Ravi K', phone: '9000000003', logging: true },
  ],
};

function signIn(overrides: Partial<ParticipantLoginResponse> = {}) {
  useAuthStore.getState().setParticipantSession({
    id: 'DS23F1000042',
    email: '23f1000042@ds.study.iitm.ac.in',
    access_token: 't',
    token_type: 'participant',
    full_name: 'Asha N',
    dob: '2004-01-01',
    house: 'Nilgiri House',
    gender: 'female',
    phone: '9000000000',
    country: 'India',
    state: 'TN',
    city: 'Chennai',
    address: 'Somewhere',
    program: 'DS',
    course_stage: 'degree',
    photo: null,
    public_key: 'k',
    ...overrides,
  } as ParticipantLoginResponse);
}

const onReportInstead = vi.fn();
const onAskInstead = vi.fn();

function renderPage() {
  return render(
    <MemoryRouter>
      <ContactsPanel onReportInstead={onReportInstead} onAskInstead={onAskInstead} />
    </MemoryRouter>,
  );
}

describe('ContactsPanel', () => {
  beforeEach(() => {
    localStorage.clear();
    useAuthStore.getState().clear();
    onReportInstead.mockClear();
    onAskInstead.mockClear();
    signIn();
    listHostels.mockResolvedValue([GANGA]);
    listMess.mockResolvedValue([HALL]);
  });

  it('lists a block with its coordinator and reachable team as dialable links', async () => {
    renderPage();
    expect(await screen.findByText('Ganga Block')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /\+91 98765 43210/ })).toHaveAttribute(
      'href',
      'tel:+919876543210',
    );
    expect(screen.getByText('Dr. Rao')).toBeInTheDocument();
    expect(screen.getByText('Meera R')).toBeInTheDocument();
  });

  it('never prints the backend\u2019s placeholder name or its "N/A" phone', async () => {
    renderPage();
    await screen.findByText('Ganga Block');
    expect(screen.queryByText('volunteer')).not.toBeInTheDocument();
    expect(screen.queryByText('N/A')).not.toBeInTheDocument();
  });

  it('lists mess halls in their own section', async () => {
    renderPage();
    expect(await screen.findByRole('heading', { name: 'Mess halls' })).toBeInTheDocument();
    expect(screen.getByText('Hall C')).toBeInTheDocument();
    expect(screen.getByText('Ravi K')).toBeInTheDocument();
  });

  it('finds a person by name across every block', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('Ganga Block');

    await user.type(screen.getByLabelText('Search'), 'meera');
    expect(screen.getByText('Meera R')).toBeInTheDocument();
    // Narrowed to whoever matched, so the coordinator drops out.
    expect(screen.queryByText('Dr. Rao')).not.toBeInTheDocument();
  });

  it('says so plainly when nothing matches', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('Ganga Block');

    await user.type(screen.getByLabelText('Search'), 'zzzz');
    expect(screen.getByText('Nobody matches that')).toBeInTheDocument();
  });

  it('prompts for the profile when the session has no emergency contact yet', async () => {
    // No route returns `profile.emergency_contact`; it only reaches the session
    // through the PATCH /profile/complete echo. The prompt therefore points at
    // the one screen that can write it, which is the profile form itself.
    renderPage();
    const link = await screen.findByRole('link', { name: 'Edit profile' });
    expect(link).toHaveAttribute('href', ROUTES.completeProfile);
  });

  it('shows the participant\u2019s own emergency contact once it is on the session', async () => {
    signIn({
      emergency_contact: { name: 'Sunita K', relation: 'elder_sibling', phone: '9998887776' },
    });
    renderPage();

    expect(await screen.findByText('Sunita K')).toBeInTheDocument();
    expect(screen.getByText(/Recorded as your elder sibling/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /9998887776/ })).toHaveAttribute(
      'href',
      'tel:9998887776',
    );
  });

  it('reports a failed load instead of rendering an empty directory', async () => {
    const { ApiClientError } = await import('@/api');
    listHostels.mockRejectedValue(new ApiClientError(500, 'Internal Server Error'));
    renderPage();
    expect(await screen.findByText('Could not load the directory')).toBeInTheDocument();
  });

  it('says nothing is published rather than showing empty cards', async () => {
    listHostels.mockResolvedValue([{ ...GANGA, coordinator: undefined, hostel_team: [] }]);
    listMess.mockResolvedValue([{ ...HALL, mess_team: [] }]);
    renderPage();
    expect(await screen.findByText('No contacts published yet')).toBeInTheDocument();
  });

  it('still reaches a human when the directory has nobody in it', async () => {
    // An unpublished directory used to be a dead end — the tab a student picks
    // when they want to talk to somebody, with nothing on it. The other two tabs
    // both still work, so it says so.
    const user = userEvent.setup();
    listHostels.mockResolvedValue([{ ...GANGA, coordinator: undefined, hostel_team: [] }]);
    listMess.mockResolvedValue([{ ...HALL, mess_team: [] }]);
    renderPage();
    await screen.findByText('No contacts published yet');

    await user.click(screen.getByRole('button', { name: /Ask the fest team/ }));
    expect(onAskInstead).toHaveBeenCalledTimes(1);
  });

  it('hands a fault to the Report tab instead of leaving the section', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('Ganga Block');

    await user.click(screen.getByRole('button', { name: /Report a problem/ }));
    expect(onReportInstead).toHaveBeenCalledTimes(1);
  });
});
