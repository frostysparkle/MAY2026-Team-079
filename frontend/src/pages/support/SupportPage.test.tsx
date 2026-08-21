import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import type {
  Event,
  Hostel,
  Issue,
  IssueListResponse,
  Mess,
  MyEventRegistration,
  MyHostelResponse,
  MyMessResponse,
  MyWorkshopRegistration,
  ParticipantLoginResponse,
  QueryRecord,
  Workshop,
} from '@/api/types';
import { useAuthStore } from '@/stores/authStore';

/**
 * Help & Support as a section, rather than as any one of the three screens it was
 * consolidated out of.
 *
 * The panels' own behaviour is covered where they live — `AskPanel.test.tsx`,
 * `ReportPanel.test.tsx`, `ContactsPanel.test.tsx`. What only exists here is the
 * consolidation itself: that the three jobs are three tabs, that the tab is in the
 * URL so a link to one opens it, that the figures span both halves rather than
 * whichever tab is showing, and that a half-typed report survives a trip to
 * another tab — which is the reason these are tabs and not routes.
 */

const myQueries = vi.fn<() => Promise<QueryRecord[]>>();
const myIssues = vi.fn<() => Promise<IssueListResponse>>();
const listEvents = vi.fn<() => Promise<Event[]>>();
const listWorkshops = vi.fn<() => Promise<Workshop[]>>();
const myEventRegistrations = vi.fn<() => Promise<MyEventRegistration[]>>();
const myWorkshopRegistrations = vi.fn<() => Promise<MyWorkshopRegistration[]>>();
const listHostels = vi.fn<() => Promise<Hostel[]>>();
const listMess = vi.fn<() => Promise<Mess[]>>();
const myHostel = vi.fn<() => Promise<MyHostelResponse>>();
const myMess = vi.fn<() => Promise<MyMessResponse>>();

vi.mock('@/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api')>();
  return {
    ...actual,
    api: {
      myQueries: () => myQueries(),
      myIssues: () => myIssues(),
      raiseQuery: vi.fn(),
      replyToQuery: vi.fn(),
      reportIssue: vi.fn(),
      listEvents: () => listEvents(),
      listWorkshops: () => listWorkshops(),
      myEventRegistrations: () => myEventRegistrations(),
      myWorkshopRegistrations: () => myWorkshopRegistrations(),
      listHostels: () => listHostels(),
      listMess: () => listMess(),
      myHostel: () => myHostel(),
      myMess: () => myMess(),
    },
  };
});

const { default: SupportPage } = await import('./SupportPage');

const GANGA: Hostel = {
  hostel_id: 'H12',
  name: 'Ganga Block',
  capacity: 300,
  gender: 'female',
  coordinator: { name: 'Dr. Rao', phone: '+91 98765 43210' },
  hostel_team: [],
};

const ALLOTTED: MyHostelResponse = {
  assigned_hostel: 'H12',
  room: '101',
  logged_in: false,
  registered: true,
  volunteers: [],
};

const NO_MESS: MyMessResponse = { allotted_mess: null, mess_details: null, slots: [] };

function query(over: Partial<QueryRecord> = {}): QueryRecord {
  return {
    query_id: 'QRY1',
    participant_id: 'DS23F1000042',
    participant_name: 'Asha N',
    participant_house: 'Nilgiri',
    category: 'general',
    target_id: null,
    subject: 'Lost my institute ID',
    body: 'Where do I collect a replacement?',
    status: 'open',
    assigned_team: null,
    assigned_to: null,
    replies: [],
    created_at: '2026-08-20T09:00:00',
    updated_at: '2026-08-20T09:00:00',
    resolved_at: null,
    ...over,
  };
}

function issue(over: Partial<Issue> = {}): Issue {
  return {
    issue_id: 'ISS1',
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
    ...over,
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

/** Publishes the current URL so a test can assert the `?tab=` round trip. */
function LocationProbe() {
  const location = useLocation();
  return <div data-testid="url">{`${location.pathname}${location.search}`}</div>;
}

function renderPage(at = '/app/support') {
  return render(
    <MemoryRouter initialEntries={[at]}>
      <Routes>
        <Route
          path="/app/support"
          element={
            <>
              <SupportPage />
              <LocationProbe />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

const tablist = () => screen.getByRole('tablist', { name: 'Help and support sections' });
const url = () => screen.getByTestId('url').textContent;

/**
 * The block's entry in the directory.
 *
 * By its heading rather than by its text: the Report panel stays mounted behind
 * the Contacts tab and names the same block in "Reporting about Ganga Block", so a
 * text query would match twice. Role queries skip `hidden` subtrees, which is
 * exactly the distinction wanted here.
 */
const blockHeading = () => screen.findByRole('heading', { name: 'Ganga Block', level: 3 });

describe('SupportPage', () => {
  beforeEach(() => {
    localStorage.clear();
    useAuthStore.getState().clear();
    signIn();
    myQueries.mockResolvedValue([]);
    myIssues.mockResolvedValue({ count: 0, issues: [] });
    listEvents.mockResolvedValue([]);
    listWorkshops.mockResolvedValue([]);
    myEventRegistrations.mockResolvedValue([]);
    myWorkshopRegistrations.mockResolvedValue([]);
    listHostels.mockResolvedValue([GANGA]);
    listMess.mockResolvedValue([]);
    myHostel.mockResolvedValue(ALLOTTED);
    myMess.mockResolvedValue(NO_MESS);
  });

  it('carries the three jobs as three tabs on one screen', async () => {
    renderPage();
    await screen.findByText('No questions yet');

    const tabs = within(tablist()).getAllByRole('tab');
    expect(tabs.map((t) => t.getAttribute('aria-selected'))).toEqual(['true', 'false', 'false']);
    expect(within(tablist()).getByRole('tab', { name: /Ask a question/ })).toBeInTheDocument();
    expect(within(tablist()).getByRole('tab', { name: /Report a problem/ })).toBeInTheDocument();
    expect(within(tablist()).getByRole('tab', { name: /Who to call/ })).toBeInTheDocument();
  });

  it('opens on Ask when no tab is named', async () => {
    renderPage();
    expect(await screen.findByText('No questions yet')).toBeInTheDocument();
    expect(within(tablist()).getByRole('tab', { name: /Ask a question/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  it('writes the chosen tab into the URL, so it can be shared and survives a refresh', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('No questions yet');

    await user.click(within(tablist()).getByRole('tab', { name: /Report a problem/ }));
    expect(url()).toBe('/app/support?tab=report');

    await user.click(within(tablist()).getByRole('tab', { name: /Who to call/ }));
    expect(url()).toBe('/app/support?tab=contacts');
  });

  it('opens the tab a link asked for', async () => {
    renderPage('/app/support?tab=contacts');
    // The directory is what `/app/help` used to be, and this is where it landed.
    expect(await blockHeading()).toBeInTheDocument();
    expect(within(tablist()).getByRole('tab', { name: /Who to call/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  it('ignores a tab name it does not have rather than showing nothing', async () => {
    renderPage('/app/support?tab=nonsense');
    expect(await screen.findByText('No questions yet')).toBeInTheDocument();
  });

  it('leaves the contacts directory unread until somebody opens that tab', async () => {
    // The other two tabs only ever need the caller's own block and hall; this one
    // reads the whole fest, so a participant who never opens it should not pay for
    // it. `useMyIssues` reads the catalogue too, hence "more than before" rather
    // than an exact count.
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('No questions yet');
    const before = listHostels.mock.calls.length;

    await user.click(within(tablist()).getByRole('tab', { name: /Who to call/ }));
    await blockHeading();
    expect(listHostels.mock.calls.length).toBeGreaterThan(before);
  });

  it('counts questions and reports as one set of figures', async () => {
    // The whole reason for one section: neither of the old screens could answer
    // "is anybody dealing with my stuff", because each held half the answer.
    myQueries.mockResolvedValue([
      query({ query_id: 'A', status: 'open' }),
      query({ query_id: 'B', status: 'resolved' }),
    ]);
    myIssues.mockResolvedValue({
      count: 2,
      issues: [
        issue({ issue_id: 'X', status: 'open' }),
        issue({ issue_id: 'Y', status: 'in_progress' }),
      ],
    });
    renderPage();

    const questions = await screen.findByRole('group', { name: 'Open questions' });
    expect(within(questions).getByText('1')).toBeInTheDocument();

    const reports = screen.getByRole('group', { name: 'Open reports' });
    expect(within(reports).getByText('2')).toBeInTheDocument();

    // One open question plus two untouched reports, none of them answered.
    const awaiting = screen.getByRole('group', { name: 'Awaiting reply' });
    expect(within(awaiting).getByText('3')).toBeInTheDocument();

    const resolved = screen.getByRole('group', { name: 'Resolved' });
    expect(within(resolved).getByText('1')).toBeInTheDocument();
  });

  it('states plainly that nothing is outstanding rather than hiding the figures', async () => {
    renderPage();
    const awaiting = await screen.findByRole('group', { name: 'Awaiting reply' });
    expect(within(awaiting).getByText('Nothing outstanding')).toBeInTheDocument();
  });

  it('badges a tab with what is still open on it', async () => {
    myIssues.mockResolvedValue({ count: 1, issues: [issue()] });
    renderPage();
    await screen.findByText('No questions yet');

    const report = within(tablist()).getByRole('tab', { name: /Report a problem/ });
    expect(within(report).getByText('1')).toBeInTheDocument();
  });

  it('keeps a half-typed report while the participant looks up a phone number', async () => {
    // This is the payoff of tabs over routes. On the old screens this errand meant
    // navigating away, which threw the draft out.
    const user = userEvent.setup();
    renderPage('/app/support?tab=report');
    await screen.findByLabelText(/Short title/);

    await user.type(screen.getByLabelText(/Short title/), 'No hot water');

    await user.click(within(tablist()).getByRole('tab', { name: /Who to call/ }));
    await blockHeading();

    await user.click(within(tablist()).getByRole('tab', { name: /Report a problem/ }));
    expect(screen.getByLabelText(/Short title/)).toHaveValue('No hot water');
  });

  it('hides the panels that are not showing from the page and from a screen reader', async () => {
    renderPage();
    await screen.findByText('No questions yet');

    const panels = document.querySelectorAll('[role="tabpanel"]');
    const hidden = Array.from(panels).filter((p) => p.hasAttribute('hidden'));
    // Ask is showing; Report is mounted behind it; Contacts is not mounted yet.
    expect(panels.length).toBe(2);
    expect(hidden.length).toBe(1);
  });

  it('reloads both halves at once', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('No questions yet');
    const queriesBefore = myQueries.mock.calls.length;
    const issuesBefore = myIssues.mock.calls.length;

    await user.click(screen.getByRole('button', { name: /Refresh/ }));

    expect(myQueries.mock.calls.length).toBeGreaterThan(queriesBefore);
    expect(myIssues.mock.calls.length).toBeGreaterThan(issuesBefore);
  });
});
