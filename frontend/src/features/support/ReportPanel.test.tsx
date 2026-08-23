import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type {
  Hostel,
  Issue,
  IssueCreateRequest,
  IssueCreateResponse,
  IssueListResponse,
  Mess,
  MyHostelResponse,
  MyMessResponse,
  ParticipantLoginResponse,
} from '@/api/types';
import { useAuthStore } from '@/stores/authStore';

/**
 * Story 5.4, the participant's half.
 *
 * The things worth pinning are the ones that stop a participant hitting a server
 * error they could not have predicted: that only their own block and hall are
 * offered (`POST /issues` 403s on anything else), that a hostel form never offers
 * a mess category (a 400), and that the outstanding-report cap is stated before
 * the eleventh report is refused rather than after. Plus the half the story is
 * actually about — that what the team says comes back and is readable.
 */

const myHostel = vi.fn<() => Promise<MyHostelResponse>>();
const myMess = vi.fn<() => Promise<MyMessResponse>>();
const myIssues = vi.fn<() => Promise<IssueListResponse>>();
const listHostels = vi.fn<() => Promise<Hostel[]>>();
const listMess = vi.fn<() => Promise<Mess[]>>();
const reportIssue = vi.fn<(req: IssueCreateRequest) => Promise<IssueCreateResponse>>();

vi.mock('@/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api')>();
  return {
    ...actual,
    api: {
      myHostel: () => myHostel(),
      myMess: () => myMess(),
      myIssues: () => myIssues(),
      listHostels: () => listHostels(),
      listMess: () => listMess(),
      reportIssue: (req: IssueCreateRequest) => reportIssue(req),
    },
  };
});

const { ApiClientError } = await import('@/api');
const { ReportPanel } = await import('./ReportPanel');
const { useMyIssues } = await import('@/features/issues/useMyIssues');

const GANGA: Hostel = {
  hostel_id: 'H12',
  name: 'Ganga Block',
  capacity: 300,
  gender: 'female',
  coordinator: { name: 'Dr. Rao', phone: '+91 98765 43210' },
  hostel_team: [],
};

const HALL: Mess = {
  mess_id: 'M3',
  name: 'Hall C',
  capacity: 500,
  type: 'south_indian__veg',
  mess_team: [
    { user_id: 'BT3', role: 'other', name: 'Ravi K', phone: '9000000003', logging: true },
  ],
};

const ALLOTTED: MyHostelResponse = {
  assigned_hostel: 'H12',
  room: '101',
  inside: false,
  registered: true,
  volunteers: [
    { name: 'Meera R', phone: '9000000002' },
    // The backend's own placeholders. Neither may become a call button.
    { name: 'volunteer', phone: 'N/A' },
  ] as MyHostelResponse['volunteers'],
};

const NO_HOSTEL: MyHostelResponse = {
  assigned_hostel: null,
  room: null,
  inside: false,
  registered: false,
  volunteers: [],
};

const NO_MESS: MyMessResponse = { allotted_mess: null, mess_details: null, slots: [] };
const ALLOTTED_MESS: MyMessResponse = { allotted_mess: 'M3', mess_details: HALL, slots: [] };

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

function signIn() {
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
  } as ParticipantLoginResponse);
}

/**
 * The panel takes its state from the section that hosts it, so the harness runs
 * the real `useMyIssues` against the mocked API — the same wiring `SupportPage`
 * does, without dragging the other two tabs' reads into every case.
 */
const onAskInstead = vi.fn();
const onFindContacts = vi.fn();

function Harness() {
  const state = useMyIssues();
  return <ReportPanel state={state} onAskInstead={onAskInstead} onFindContacts={onFindContacts} />;
}

function renderPage() {
  return render(
    <MemoryRouter>
      <Harness />
    </MemoryRouter>,
  );
}

describe('ReportPanel', () => {
  beforeEach(() => {
    localStorage.clear();
    useAuthStore.getState().clear();
    onAskInstead.mockClear();
    onFindContacts.mockClear();
    signIn();
    myHostel.mockResolvedValue(ALLOTTED);
    myMess.mockResolvedValue(NO_MESS);
    myIssues.mockResolvedValue({ count: 0, issues: [] });
    listHostels.mockResolvedValue([GANGA]);
    listMess.mockResolvedValue([HALL]);
    reportIssue.mockResolvedValue({
      message: 'Issue reported',
      issue_id: 'ISS17555000009999',
      status: 'open',
    });
  });

  it('states the single facility rather than asking a question with one answer', async () => {
    renderPage();
    const stated = await screen.findByText(/Reporting about/);
    expect(stated).toHaveTextContent('Ganga Block');
    expect(stated).toHaveTextContent('101');
    // No picker: there is nothing to pick between.
    expect(screen.queryByLabelText(/Where is the problem/)).not.toBeInTheDocument();
  });

  it('offers a picker, and only the caller’s own places, when they hold both', async () => {
    myMess.mockResolvedValue(ALLOTTED_MESS);
    renderPage();

    const picker = await screen.findByLabelText(/Where is the problem/);
    const options = Array.from(picker.querySelectorAll('option')).map((o) => o.textContent);
    expect(options).toEqual(['Ganga Block (block)', 'Hall C (mess)']);
  });

  it('offers only hostel categories for a hostel, so the backend never 400s', async () => {
    renderPage();
    const categories = await screen.findByLabelText(/What kind of problem/);
    const values = Array.from(categories.querySelectorAll('option')).map(
      (o) => (o as HTMLOptionElement).value,
    );
    expect(values).toContain('water');
    expect(values).not.toContain('food_quality');
  });

  it('swaps the category list when the facility changes', async () => {
    myMess.mockResolvedValue(ALLOTTED_MESS);
    renderPage();

    await userEvent.selectOptions(await screen.findByLabelText(/Where is the problem/), 'mess:M3');
    const categories = screen.getByLabelText(/What kind of problem/);
    const values = Array.from(categories.querySelectorAll('option')).map(
      (o) => (o as HTMLOptionElement).value,
    );
    expect(values).toContain('food_quality');
    expect(values).not.toContain('water');
  });

  it('files a report against the right facility and shows the reference back', async () => {
    renderPage();
    await screen.findByLabelText(/What kind of problem/);

    await userEvent.selectOptions(screen.getByLabelText(/What kind of problem/), 'water');
    await userEvent.type(screen.getByLabelText(/Short title/), 'No hot water');
    await userEvent.type(screen.getByLabelText(/What is wrong/), 'Cold since 6am.');
    await userEvent.click(screen.getByRole('button', { name: /File this report/ }));

    expect(reportIssue).toHaveBeenCalledWith({
      facility_type: 'hostel',
      facility_id: 'H12',
      category: 'water',
      subject: 'No hot water',
      body: 'Cold since 6am.',
    });
    expect(await screen.findByText(/ISS17555000009999/)).toBeInTheDocument();
  });

  it('omits the room so the backend can fall back to the allotted one', async () => {
    renderPage();
    await screen.findByLabelText(/What kind of problem/);

    await userEvent.selectOptions(screen.getByLabelText(/What kind of problem/), 'electricity');
    await userEvent.type(screen.getByLabelText(/Short title/), 'Fan not working');
    await userEvent.type(screen.getByLabelText(/What is wrong/), 'Stopped last night.');
    await userEvent.click(screen.getByRole('button', { name: /File this report/ }));

    expect(reportIssue.mock.calls[0][0]).not.toHaveProperty('room');
  });

  it('validates before spending a request, and says which field is wrong', async () => {
    renderPage();
    await screen.findByLabelText(/What kind of problem/);

    await userEvent.click(screen.getByRole('button', { name: /File this report/ }));

    expect(reportIssue).not.toHaveBeenCalled();
    expect(await screen.findByText(/Choose what kind of problem/)).toBeInTheDocument();
    expect(screen.getByText(/at least 3 characters/)).toBeInTheDocument();
    expect(screen.getByText(/Describe the problem/)).toBeInTheDocument();
  });

  it('shows the server’s own reason when a report is refused', async () => {
    reportIssue.mockRejectedValue(new ApiClientError(403, 'You are not allotted to this hostel'));
    renderPage();
    await screen.findByLabelText(/What kind of problem/);

    await userEvent.selectOptions(screen.getByLabelText(/What kind of problem/), 'water');
    await userEvent.type(screen.getByLabelText(/Short title/), 'A leak');
    await userEvent.type(screen.getByLabelText(/What is wrong/), 'Under the sink.');
    await userEvent.click(screen.getByRole('button', { name: /File this report/ }));

    expect(await screen.findByText('You are not allotted to this hostel')).toBeInTheDocument();
  });

  it('blocks the form at the cap rather than letting the server refuse it', async () => {
    myIssues.mockResolvedValue({
      count: 10,
      issues: Array.from({ length: 10 }, (_, i) => issue({ issue_id: `ISS${i}`, status: 'open' })),
    });
    renderPage();

    expect(await screen.findByText(/reached the limit here/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /File this report/ })).toBeDisabled();
  });

  it('warns short of the cap without blocking', async () => {
    myIssues.mockResolvedValue({
      count: 2,
      issues: [issue({ issue_id: 'a' }), issue({ issue_id: 'b' })],
    });
    renderPage();

    expect(await screen.findByText(/You have 2 unresolved reports/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /File this report/ })).toBeEnabled();
  });

  it('shows what the team said, which is the whole point of the story', async () => {
    myIssues.mockResolvedValue({
      count: 1,
      issues: [
        issue({
          status: 'in_progress',
          updates: [
            { at: '2026-08-20T07:00:00', status: 'in_progress', note: 'Plumber called, 4pm.' },
          ],
        }),
      ],
    });
    renderPage();

    expect(await screen.findByText('No hot water')).toBeInTheDocument();
    expect(screen.getByText('Being worked on')).toBeInTheDocument();
    expect(screen.getByText('Plumber called, 4pm.')).toBeInTheDocument();
  });

  it('expands to the full history on request', async () => {
    myIssues.mockResolvedValue({
      count: 1,
      issues: [
        issue({
          status: 'resolved',
          updates: [
            { at: '2026-08-20T07:00:00', status: 'in_progress', note: 'Looking at it.' },
            { at: '2026-08-20T09:00:00', status: 'resolved', note: 'Element replaced.' },
          ],
        }),
      ],
    });
    renderPage();

    await userEvent.click(await screen.findByRole('button', { name: /Show all 2 updates/ }));
    expect(screen.getByText('Looking at it.')).toBeInTheDocument();
    expect(screen.getByText('Element replaced.')).toBeInTheDocument();
  });

  it('offers the block’s reachable duty contacts for anything urgent', async () => {
    renderPage();
    expect(await screen.findByRole('link', { name: 'Meera R' })).toHaveAttribute(
      'href',
      'tel:9000000002',
    );
    // The backend's `"volunteer"` / `"N/A"` placeholders never become a button.
    expect(screen.queryByRole('link', { name: /volunteer/i })).not.toBeInTheDocument();
    expect(screen.queryByText('N/A')).not.toBeInTheDocument();
  });

  it('pre-writes the typed report into the SMS hand-off', async () => {
    renderPage();
    await screen.findByLabelText(/What kind of problem/);

    await userEvent.selectOptions(screen.getByLabelText(/What kind of problem/), 'safety');
    await userEvent.type(screen.getByLabelText(/Short title/), 'Gas smell');

    const text = screen.getByRole('link', { name: /Text this report to Meera R/ });
    const href = text.getAttribute('href') ?? '';
    expect(href.startsWith('sms:9000000002?body=')).toBe(true);
    expect(decodeURIComponent(href)).toContain('Ganga Block (room 101)');
    expect(decodeURIComponent(href)).toContain('Safety: Gas smell');
  });

  it('explains itself instead of showing a dead form to an unplaced participant', async () => {
    myHostel.mockResolvedValue(NO_HOSTEL);
    myMess.mockResolvedValue(NO_MESS);
    renderPage();

    expect(await screen.findByText(/Nothing to report against yet/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /File this report/ })).not.toBeInTheDocument();
  });

  it('offers an unplaced participant three real ways on, not a dead end', async () => {
    // This state used to be the end of the road: one card, one link out of the
    // section, and no way to get a problem in front of anybody. On the tab a
    // student opens *because* something is wrong, that reads as broken.
    const user = userEvent.setup();
    myHostel.mockResolvedValue(NO_HOSTEL);
    myMess.mockResolvedValue(NO_MESS);
    renderPage();
    await screen.findByText(/Nothing to report against yet/);

    // A question reaches the core team whether or not you hold an allocation.
    await user.click(screen.getByRole('button', { name: /Ask the fest team/ }));
    expect(onAskInstead).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: /Who to call/ }));
    expect(onFindContacts).toHaveBeenCalledTimes(1);

    // And the reason it is empty, with the screen that fixes it.
    expect(screen.getByRole('link', { name: /Manage my stay/ })).toHaveAttribute(
      'href',
      '/app/accommodation',
    );
  });

  it('offers a way through at the report cap rather than only refusing', async () => {
    const user = userEvent.setup();
    myIssues.mockResolvedValue({
      count: 10,
      issues: Array.from({ length: 10 }, (_, i) => issue({ issue_id: `ISS${i}`, status: 'open' })),
    });
    renderPage();
    await screen.findByText(/reached the limit here/i);

    await user.click(screen.getByRole('button', { name: /Ask the fest team instead/ }));
    expect(onAskInstead).toHaveBeenCalledTimes(1);
  });

  it('reports a failed load rather than an empty list', async () => {
    myIssues.mockRejectedValue(new ApiClientError(401, 'Invalid authentication credentials'));
    renderPage();

    expect(await screen.findByText(/Reports unavailable/)).toBeInTheDocument();
    expect(screen.getByText('Invalid authentication credentials')).toBeInTheDocument();
  });

  it('still works when the catalogue reads fail, naming the block by its id', async () => {
    listHostels.mockRejectedValue(new ApiClientError(500, 'boom'));
    listMess.mockRejectedValue(new ApiClientError(500, 'boom'));
    renderPage();

    // The name is gone but the option is not: `H12` is what `POST /issues` wants.
    expect(await screen.findByText(/Reporting about/)).toHaveTextContent('H12');
    expect(screen.getByRole('button', { name: /File this report/ })).toBeEnabled();
  });
});
