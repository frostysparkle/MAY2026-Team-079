import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type {
  Event,
  Hostel,
  Mess,
  QueryRecord,
  QueryReplyResponse,
  QueryUpdateRequest,
  QueryUpdateResponse,
  StaffLoginResponse,
  Workshop,
} from '@/api/types';
import { useAuthStore } from '@/stores/authStore';

/**
 * Stories 6.3 and 6.4, from the desk that answers.
 *
 * The scoping is the backend's and is asserted in `backend/testing/queries/`, so
 * what matters here is the console: that the work is ordered so the forgotten
 * ones surface, that a status change and a claim send what the API expects, and
 * that answering a participant is one box and one button.
 */

const listQueries = vi.fn<() => Promise<QueryRecord[]>>();
const updateQuery = vi.fn<(id: string, req: QueryUpdateRequest) => Promise<QueryUpdateResponse>>();
const replyToQuery = vi.fn<(id: string, req: { body: string }) => Promise<QueryReplyResponse>>();
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
      listEvents: () => listEvents(),
      listWorkshops: () => listWorkshops(),
      listHostels: () => listHostels(),
      listMess: () => listMess(),
    },
  };
});

const { default: QueryConsolePage } = await import('./QueryConsolePage');

const GANGA: Hostel = {
  hostel_id: 'GANGA',
  name: 'Ganga Block',
  capacity: 300,
  gender: 'male',
  coordinator: {},
  hostel_team: [{ user_id: 'BT1', role: 'volunteer', name: 'Meera R', phone: 'x', logging: true }],
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
      <QueryConsolePage />
    </MemoryRouter>,
  );
}

describe('QueryConsolePage', () => {
  beforeEach(() => {
    localStorage.clear();
    useAuthStore.getState().clear();
    signIn();
    listQueries.mockResolvedValue([record()]);
    listEvents.mockResolvedValue([]);
    listWorkshops.mockResolvedValue([]);
    listHostels.mockResolvedValue([GANGA]);
    listMess.mockResolvedValue([]);
    updateQuery.mockImplementation(async (id, req) => ({
      message: 'Query updated',
      query: record({ query_id: id, ...req }),
    }));
  });

  it('reads an empty queue as a quiet fest, not a broken screen', async () => {
    listQueries.mockResolvedValue([]);
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
    expect(screen.queryByRole('link', { name: /tel:/ })).not.toBeInTheDocument();
  });

  it('counts what is outstanding and what nobody has replied to', async () => {
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
    renderPage();

    const outstanding = await screen.findByRole('group', { name: 'Outstanding' });
    expect(within(outstanding).getByText('2')).toBeInTheDocument();
    expect(within(outstanding).getByText('2 nobody has replied to')).toBeInTheDocument();
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
    // The row comes back from the server already marked assigned, so the button
    // is replaced rather than the client guessing the new state.
    expect(await screen.findByText('Yours')).toBeInTheDocument();
  });

  it('does not offer to claim one already held by the caller', async () => {
    listQueries.mockResolvedValue([record({ status: 'assigned', assigned_to: 'BT1' })]);
    renderPage();
    await screen.findByText('Can I check in a day early?');

    expect(screen.queryByRole('button', { name: /Take this one/ })).not.toBeInTheDocument();
    expect(screen.getByText('Yours')).toBeInTheDocument();
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

  it('keeps a failed reply in the box rather than losing what was typed', async () => {
    const user = userEvent.setup();
    const { ApiClientError } = await import('@/api');
    replyToQuery.mockRejectedValue(new ApiClientError(403, 'Not authorized to handle this query'));
    renderPage();
    await screen.findByText('Can I check in a day early?');

    const box = screen.getByPlaceholderText('Answer the participant…');
    await user.click(box);
    await user.paste('Long answer nobody wants to retype.');
    await user.click(screen.getByRole('button', { name: /Send reply/ }));

    expect(await screen.findByText('Not authorized to handle this query')).toBeInTheDocument();
    expect(box).toHaveValue('Long answer nobody wants to retype.');
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
