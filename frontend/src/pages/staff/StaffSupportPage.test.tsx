import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type {
  Event,
  Hostel,
  IssueUpdateRequest,
  IssueUpdateResponse,
  Mess,
  QueryRecord,
  QueryReplyResponse,
  QueryUpdateRequest,
  QueryUpdateResponse,
  StaffIssue,
  StaffIssueListResponse,
  StaffLoginResponse,
  Workshop,
} from '@/api/types';
import { useAuthStore } from '@/stores/authStore';

/**
 * The staff Support desk — Story 5.4's answering half and Stories 6.3/6.4, in one
 * section.
 *
 * The scoping is the backend's and is asserted in `backend/testing/queries/` and
 * `backend/testing/issues/`, so what matters here is the desk: that the shared
 * figures count both queues, that each tab still does the job its own console did,
 * and that the two things the merge was for actually hold — one answer to "is
 * anybody waiting on me", and a half-typed reply that survives a tab switch.
 */

const listQueries = vi.fn<() => Promise<QueryRecord[]>>();
const updateQuery = vi.fn<(id: string, req: QueryUpdateRequest) => Promise<QueryUpdateResponse>>();
const replyToQuery = vi.fn<(id: string, req: { body: string }) => Promise<QueryReplyResponse>>();
const listIssues = vi.fn<() => Promise<StaffIssueListResponse>>();
const updateIssue = vi.fn<(id: string, req: IssueUpdateRequest) => Promise<IssueUpdateResponse>>();
const listEvents = vi.fn<() => Promise<Event[]>>();
const listWorkshops = vi.fn<() => Promise<Workshop[]>>();
const listHostels = vi.fn<() => Promise<Hostel[]>>();
const listMess = vi.fn<() => Promise<Mess[]>>();

vi.mock('@/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api')>();
  return {
    ...actual,
    api: {
      listQueries: () => listQueries(),
      updateQuery: (id: string, req: QueryUpdateRequest) => updateQuery(id, req),
      replyToQuery: (id: string, req: { body: string }) => replyToQuery(id, req),
      listIssues: () => listIssues(),
      updateIssue: (id: string, req: IssueUpdateRequest) => updateIssue(id, req),
      listEvents: () => listEvents(),
      listWorkshops: () => listWorkshops(),
      listHostels: () => listHostels(),
      listMess: () => listMess(),
    },
  };
});

const { default: StaffSupportPage } = await import('./StaffSupportPage');

const GANGA: Hostel = {
  hostel_id: 'GANGA',
  name: 'Ganga Block',
  capacity: 300,
  gender: 'male',
  coordinator: {},
  hostel_team: [
    { user_id: 'BT1', role: 'hostel_volunteer', name: 'Meera R', phone: 'x', attendance: true },
  ],
};

function record(overrides: Partial<QueryRecord> = {}): QueryRecord {
  return {
    query_id: 'QRY1',
    participant_id: 'DS23F1000042',
    participant_name: 'Asha N',
    participant_house: 'Nilgiri',
    category: 'hostel',
    target_id: 'GANGA',
    subject: 'Can I check in a day early?',
    body: 'My train arrives on the 8th.',
    status: 'open',
    assigned_team: null,
    assigned_to: null,
    replies: [],
    created_at: '2026-08-20T09:00:00',
    updated_at: '2026-08-20T09:00:00',
    resolved_at: null,
    ...overrides,
  };
}

function report(overrides: Partial<StaffIssue> = {}): StaffIssue {
  return {
    issue_id: 'ISS1',
    facility_type: 'hostel',
    facility_id: 'GANGA',
    category: 'water',
    subject: 'No hot water on the second floor',
    body: 'Cold since last night.',
    room: '204',
    status: 'open',
    created_at: '2026-08-20T08:00:00',
    updated_at: '2026-08-20T08:00:00',
    updates: [],
    reporter: {
      participant_id: 'DS23F1000042',
      name: 'Asha N',
      phone: '9876500011',
      room: '204',
    },
    ...overrides,
  };
}

function signIn() {
  useAuthStore.getState().setStaffSession({
    id: 'BT1',
    email: 'bt1@ds.study.iitm.ac.in',
    access_token: 't',
    token_type: 'staff',
    role: 'volunteer',
    department: 'hostels',
    designation: 'Block Volunteer',
  } as StaffLoginResponse);
}

function renderPage() {
  return render(
    <MemoryRouter>
      <StaffSupportPage />
    </MemoryRouter>,
  );
}

/** The Reported faults tab, by its accessible name rather than its text. */
const faultsTab = () => screen.getByRole('tab', { name: /Reported faults/ });

/**
 * The panel currently on show.
 *
 * Both panels stay mounted — that is the point of tabs over two routes — so the
 * hidden one is still in the DOM and a bare `getByText` would match twice. Role
 * queries skip `hidden` subtrees, so this resolves to exactly the visible panel.
 */
const panel = () => screen.getByRole('tabpanel');

describe('StaffSupportPage', () => {
  beforeEach(() => {
    localStorage.clear();
    useAuthStore.getState().clear();
    signIn();
    listQueries.mockResolvedValue([record()]);
    listIssues.mockResolvedValue({ count: 0, issues: [] });
    listEvents.mockResolvedValue([]);
    listWorkshops.mockResolvedValue([]);
    listHostels.mockResolvedValue([GANGA]);
    listMess.mockResolvedValue([]);
    updateQuery.mockImplementation(async (id, req) => ({
      message: 'Query updated',
      query: record({ query_id: id, ...req }),
    }));
    updateIssue.mockImplementation(async (id) => ({
      message: 'Issue updated',
      issue_id: id,
      status: 'in_progress',
    }));
  });

  it('offers both queues as tabs of one section', async () => {
    renderPage();
    await screen.findByText('Can I check in a day early?');

    const tabs = screen.getByRole('tablist', { name: 'Support desk sections' });
    expect(within(tabs).getByRole('tab', { name: /Questions/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(within(tabs).getByRole('tab', { name: /Reported faults/ })).toBeInTheDocument();
  });

  /**
   * The figure neither console could produce: each held half the answer, so a
   * volunteer had to open both to learn whether anything was waiting on them.
   */
  it('counts both queues together in one row of figures', async () => {
    listQueries.mockResolvedValue([
      record({ query_id: 'A', status: 'open' }),
      record({ query_id: 'B', status: 'assigned', assigned_to: 'BT9' }),
      record({
        query_id: 'C',
        status: 'resolved',
        replies: [
          {
            author_id: 'BT1',
            author_type: 'staff',
            author_name: 'Block Volunteer',
            body: 'Yes.',
            timestamp: '2026-08-20T10:00:00',
          },
        ],
      }),
    ]);
    listIssues.mockResolvedValue({
      count: 2,
      issues: [
        report({ issue_id: 'X', status: 'open' }),
        report({ issue_id: 'Y', status: 'resolved' }),
      ],
    });
    renderPage();

    const questions = await screen.findByRole('group', { name: 'Open questions' });
    expect(within(questions).getByText('2')).toBeInTheDocument();

    const faults = screen.getByRole('group', { name: 'Open faults' });
    expect(within(faults).getByText('1')).toBeInTheDocument();

    // Outstanding on both sides with nobody having written back: two queries and
    // the one open report.
    const waiting = screen.getByRole('group', { name: 'No reply yet' });
    expect(within(waiting).getByText('3')).toBeInTheDocument();

    // Closed out spans both collections — one answered query, one fixed fault.
    const closed = screen.getByRole('group', { name: 'Closed out' });
    expect(within(closed).getByText('2')).toBeInTheDocument();
  });

  it('badges each tab with what is still open on it', async () => {
    listIssues.mockResolvedValue({ count: 1, issues: [report()] });
    renderPage();
    await screen.findByText('Can I check in a day early?');

    // The badge is its own element inside the tab, so it is asserted there rather
    // than through the tab's accessible name, which runs the labels together.
    expect(
      within(screen.getByRole('tab', { name: /Questions/ })).getByText('1'),
    ).toBeInTheDocument();
    expect(within(faultsTab()).getByText('1')).toBeInTheDocument();
  });

  it('refreshes both queues from one button', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('Can I check in a day early?');
    const queriesBefore = listQueries.mock.calls.length;
    const issuesBefore = listIssues.mock.calls.length;

    await user.click(screen.getByRole('button', { name: /Refresh/ }));

    expect(listQueries.mock.calls.length).toBeGreaterThan(queriesBefore);
    expect(listIssues.mock.calls.length).toBeGreaterThan(issuesBefore);
  });

  /**
   * The other thing the merge buys. Two routes remounted; two tabs do not, so a
   * volunteer can check a fault mid-sentence without losing the sentence.
   */
  it('keeps a half-typed reply through a trip to the other tab', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('Can I check in a day early?');

    const box = screen.getByPlaceholderText('Answer the participant…');
    await user.click(box);
    await user.paste('Half of an answer');

    await user.click(faultsTab());
    await user.click(screen.getByRole('tab', { name: /Questions/ }));

    expect(screen.getByPlaceholderText('Answer the participant…')).toHaveValue('Half of an answer');
  });

  describe('the questions tab', () => {
    it('reads an empty queue as a quiet fest, not a broken screen', async () => {
      listQueries.mockResolvedValue([]);
      renderPage();
      expect(await screen.findByText('Nothing waiting on you')).toBeInTheDocument();
    });

    /**
     * `GET /queries` refuses staff outside the query team outright — there is no
     * per-entity scope to fall back to — and an event-team volunteer is on
     * nobody's query team, so every visit to Support showed them a red "Could
     * not load the queue" for a queue they can never be part of. The refusal is
     * the backend's way of saying "not your desk", which is the same answer the
     * empty state gives: both mean nothing is waiting on you.
     */
    it('reads the query-team 403 as an empty queue, not an error', async () => {
      const { ApiClientError } = await import('@/api');
      listQueries.mockRejectedValue(new ApiClientError(403, 'Not authorized to access queries'));
      renderPage();
      expect(await screen.findByText('Nothing waiting on you')).toBeInTheDocument();
    });

    it('shows a query with who asked it and what it is about', async () => {
      renderPage();
      expect(await screen.findByText('Can I check in a day early?')).toBeInTheDocument();
      expect(screen.getByText(/Asha N · Nilgiri/)).toBeInTheDocument();
      expect(screen.getByText('Ganga Block')).toBeInTheDocument();
    });

    it('never shows a phone number, because the API does not return one', async () => {
      renderPage();
      await screen.findByText('Can I check in a day early?');
      expect(screen.queryByRole('link', { name: /Call/ })).not.toBeInTheDocument();
    });

    it('puts the query nobody has answered above the one already claimed and answered', async () => {
      listQueries.mockResolvedValue([
        record({
          query_id: 'ANSWERED',
          subject: 'Already answered',
          status: 'assigned',
          replies: [
            {
              author_id: 'BT1',
              author_type: 'staff',
              author_name: 'Block Volunteer',
              body: 'Looking into it.',
              timestamp: '2026-08-20T10:00:00',
            },
          ],
        }),
        record({ query_id: 'SILENT', subject: 'Nobody replied', status: 'assigned' }),
      ]);
      renderPage();
      await screen.findByText('Nobody replied');

      const headings = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
      expect(headings.indexOf('Nobody replied')).toBeLessThan(headings.indexOf('Already answered'));
    });

    it('sets a status through PATCH /queries/{id}', async () => {
      const user = userEvent.setup();
      renderPage();
      await screen.findByText('Can I check in a day early?');

      const thread = screen.getByRole('article');
      await user.selectOptions(within(thread).getByLabelText('Status'), 'resolved');

      expect(updateQuery).toHaveBeenCalledWith('QRY1', { status: 'resolved' });
    });

    it('claims a query by naming the caller, which the backend reads as assigned', async () => {
      const user = userEvent.setup();
      renderPage();
      await screen.findByText('Can I check in a day early?');

      await user.click(screen.getByRole('button', { name: /Take this one/ }));

      expect(updateQuery).toHaveBeenCalledWith('QRY1', {
        assigned_to: 'BT1',
        assigned_team: 'Block Volunteer',
      });
      expect(await screen.findByText('Yours')).toBeInTheDocument();
    });

    it('answers the participant in one box', async () => {
      const user = userEvent.setup();
      replyToQuery.mockResolvedValue({
        message: 'Reply added',
        reply: {
          author_id: 'BT1',
          author_type: 'staff',
          author_name: 'Block Volunteer',
          body: 'Yes, report to the desk after 6pm.',
          timestamp: '2026-08-20T11:00:00',
        },
      });
      renderPage();
      await screen.findByText('Can I check in a day early?');

      await user.click(screen.getByPlaceholderText('Answer the participant…'));
      await user.paste('Yes, report to the desk after 6pm.');
      await user.click(screen.getByRole('button', { name: /Send reply/ }));

      expect(replyToQuery).toHaveBeenCalledWith('QRY1', {
        body: 'Yes, report to the desk after 6pm.',
      });
      expect(await screen.findByText('Yes, report to the desk after 6pm.')).toBeInTheDocument();
    });

    it('reports a failed update without pretending it saved', async () => {
      const user = userEvent.setup();
      const { ApiClientError } = await import('@/api');
      updateQuery.mockRejectedValue(new ApiClientError(403, 'Not authorized to handle this query'));
      renderPage();
      await screen.findByText('Can I check in a day early?');

      await user.click(screen.getByRole('button', { name: /Take this one/ }));
      expect(await screen.findByText('Not saved')).toBeInTheDocument();
    });

    it('filters to the ones nobody has replied to', async () => {
      const user = userEvent.setup();
      listQueries.mockResolvedValue([
        record({ query_id: 'SILENT', subject: 'Nobody replied' }),
        record({
          query_id: 'DONE',
          subject: 'Already closed',
          status: 'resolved',
          replies: [
            {
              author_id: 'BT1',
              author_type: 'staff',
              author_name: 'Block Volunteer',
              body: 'Sorted.',
              timestamp: '2026-08-20T10:00:00',
            },
          ],
        }),
      ]);
      renderPage();
      await screen.findByText('Nobody replied');

      await user.selectOptions(screen.getByLabelText('Show'), 'unanswered');
      expect(screen.getByText('Nobody replied')).toBeInTheDocument();
      expect(screen.queryByText('Already closed')).not.toBeInTheDocument();
    });

    it('breaks the outstanding work down by area', async () => {
      listQueries.mockResolvedValue([
        record({ query_id: 'A', category: 'hostel' }),
        record({ query_id: 'B', category: 'general', target_id: null }),
      ]);
      renderPage();
      await screen.findByRole('heading', { name: 'Outstanding by area' });

      expect(screen.getByText('My hostel block · 1')).toBeInTheDocument();
      expect(screen.getByText('Something else · 1')).toBeInTheDocument();
    });

    it('reports a failed load with a retry rather than an empty queue', async () => {
      const { ApiClientError } = await import('@/api');
      listQueries.mockRejectedValue(new ApiClientError(500, 'Internal Server Error'));
      renderPage();
      expect(await screen.findByText('Could not load the queue')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    });
  });

  describe('the faults tab', () => {
    it('says nothing is assigned rather than claiming the fest has no problems', async () => {
      const user = userEvent.setup();
      renderPage();
      await screen.findByText('Can I check in a day early?');

      await user.click(faultsTab());
      expect(within(panel()).getByText('Nothing reported to you')).toBeInTheDocument();
    });

    it('shows a report with the reporter and a way to ring them', async () => {
      const user = userEvent.setup();
      listIssues.mockResolvedValue({ count: 1, issues: [report()] });
      renderPage();
      await screen.findByText('Can I check in a day early?');

      await user.click(faultsTab());

      const faults = within(panel());
      expect(faults.getByText('No hot water on the second floor')).toBeInTheDocument();
      expect(faults.getByText('Ganga Block', { exact: false })).toBeInTheDocument();
      // The distinction that keeps the two rows apart: a fault carries a number.
      expect(faults.getByRole('link', { name: /Call Asha N/ })).toHaveAttribute(
        'href',
        'tel:9876500011',
      );
    });

    it('moves a report along through PATCH /issues/{id}', async () => {
      const user = userEvent.setup();
      listIssues.mockResolvedValue({ count: 1, issues: [report()] });
      renderPage();
      await screen.findByText('Can I check in a day early?');
      await user.click(faultsTab());

      await user.click(screen.getByRole('button', { name: /Working on it/ }));

      expect(updateIssue).toHaveBeenCalledWith('ISS1', { status: 'in_progress' });
    });

    it('sends a note and a status as one action', async () => {
      const user = userEvent.setup();
      listIssues.mockResolvedValue({ count: 1, issues: [report()] });
      renderPage();
      await screen.findByText('Can I check in a day early?');
      await user.click(faultsTab());

      await user.click(screen.getByLabelText('Note for report ISS1'));
      await user.paste('Plumber on the way.');
      await user.click(screen.getByRole('button', { name: /Resolve/ }));

      expect(updateIssue).toHaveBeenCalledWith('ISS1', {
        status: 'resolved',
        note: 'Plumber on the way.',
      });
    });

    it('counts each option on the filter, so nothing the stat cards said was lost', async () => {
      const user = userEvent.setup();
      listIssues.mockResolvedValue({
        count: 2,
        issues: [
          report({ issue_id: 'A', status: 'in_progress' }),
          report({ issue_id: 'B', status: 'resolved' }),
        ],
      });
      renderPage();
      await screen.findByText('Can I check in a day early?');
      await user.click(faultsTab());

      const show = within(panel()).getByLabelText('Show');
      expect(within(show).getByRole('option', { name: 'Being worked on (1)' })).toBeInTheDocument();
      expect(within(show).getByRole('option', { name: 'Resolved (1)' })).toBeInTheDocument();
    });

    it('reports a failed load with a retry', async () => {
      const user = userEvent.setup();
      const { ApiClientError } = await import('@/api');
      listIssues.mockRejectedValue(new ApiClientError(500, 'Internal Server Error'));
      renderPage();
      await screen.findByText('Can I check in a day early?');

      await user.click(faultsTab());
      expect(screen.getByText('Could not load reported issues')).toBeInTheDocument();
    });
  });
});
