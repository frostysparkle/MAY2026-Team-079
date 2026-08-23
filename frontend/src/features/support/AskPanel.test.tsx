import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type {
  Event,
  Hostel,
  Mess,
  MyEventRegistration,
  MyHostelResponse,
  MyMessResponse,
  MyWorkshopRegistration,
  QueryCreateRequest,
  QueryCreateResponse,
  QueryRecord,
  QueryReplyResponse,
  Workshop,
} from '@/api/types';

/**
 * Stories 6.1 and 6.2, from the side a participant actually sees.
 *
 * The resolver tests cover the rules; these cover the screen: that the form only
 * offers places this participant is connected to, that what leaves the browser is
 * the shape `POST /queries` wants, that a staff reply is readable, and that a
 * failure is reported rather than swallowed.
 */

const myQueries = vi.fn<() => Promise<QueryRecord[]>>();
const raiseQuery = vi.fn<(req: QueryCreateRequest) => Promise<QueryCreateResponse>>();
const replyToQuery = vi.fn<(id: string, req: { body: string }) => Promise<QueryReplyResponse>>();
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
      raiseQuery: (req: QueryCreateRequest) => raiseQuery(req),
      replyToQuery: (id: string, req: { body: string }) => replyToQuery(id, req),
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

const { AskPanel } = await import('./AskPanel');
const { useMyQueries } = await import('@/features/queries/useMyQueries');

const HACKATHON = {
  event_id: 'EV_HACK',
  event_type: 'technical',
  name: 'Paradox Hackathon',
  description: '',
  team: { min: 1, max: 4, house_vs_house_event: false, allow_single_registration: true },
  prize_money: [],
  registration: {},
  schedule: [],
  registration_fields: [],
  event_team: [],
} as Event;

const GANGA: Hostel = {
  hostel_id: 'GANGA',
  name: 'Ganga Block',
  capacity: 300,
  gender: 'male',
  coordinator: {},
  hostel_team: [],
};

function record(overrides: Partial<QueryRecord> = {}): QueryRecord {
  return {
    query_id: 'QRY20260820ABCDEF',
    participant_id: 'DS23F1000042',
    participant_name: 'Meera R',
    participant_house: 'Ganga',
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

/**
 * The panel takes its state from the section that hosts it, so the harness runs
 * the real `useMyQueries` against the mocked API — the same wiring
 * `SupportPage` does, without dragging the other two tabs' reads into every case.
 */
const onReportInstead = vi.fn();

function Harness() {
  const state = useMyQueries();
  return <AskPanel state={state} onReportInstead={onReportInstead} />;
}

function renderPage() {
  return render(
    <MemoryRouter>
      <Harness />
    </MemoryRouter>,
  );
}

describe('AskPanel', () => {
  beforeEach(() => {
    onReportInstead.mockClear();
    myQueries.mockResolvedValue([]);
    listEvents.mockResolvedValue([HACKATHON]);
    listWorkshops.mockResolvedValue([]);
    myEventRegistrations.mockResolvedValue([{ event_id: 'EV_HACK' } as MyEventRegistration]);
    myWorkshopRegistrations.mockResolvedValue([]);
    listHostels.mockResolvedValue([GANGA]);
    listMess.mockResolvedValue([]);
    myHostel.mockResolvedValue({ assigned_hostel: 'GANGA', room: '214' } as MyHostelResponse);
    myMess.mockResolvedValue({ allotted_mess: null } as unknown as MyMessResponse);
    raiseQuery.mockImplementation(async (req) => ({
      message: 'Query raised',
      query_id: 'QRY_NEW',
      query: record({ query_id: 'QRY_NEW', ...req, target_id: req.target_id ?? null }),
    }));
  });

  it('says so plainly when nothing has been asked yet', async () => {
    renderPage();
    expect(await screen.findByText('No questions yet')).toBeInTheDocument();
  });

  it('offers only the event registered for and the block allotted, plus general', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('No questions yet');

    await user.click(screen.getByRole('button', { name: /Ask a question/ }));
    const category = screen.getByLabelText(/What is this about/);
    const offered = within(category)
      .getAllByRole('option')
      .map((option) => option.textContent);

    expect(offered).toContain('An event');
    expect(offered).toContain('My hostel block');
    expect(offered).toContain('Something else');
    // No mess allocation, so there is nothing to ask a hall about.
    expect(offered).not.toContain('My mess hall');
    // No workshop booking either.
    expect(offered).not.toContain('A workshop');
  });

  it('sends exactly what POST /queries wants', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('No questions yet');

    await user.click(screen.getByRole('button', { name: /Ask a question/ }));
    await user.selectOptions(screen.getByLabelText(/What is this about/), 'hostel');
    await user.selectOptions(screen.getByLabelText(/^Which one\?/), 'GANGA');
    await user.click(screen.getByLabelText(/^Title/));
    await user.paste('Early check-in');
    await user.click(screen.getByLabelText(/^Your question/));
    await user.paste('My train arrives on the 8th.');
    await user.click(screen.getByRole('button', { name: /Send to the team/ }));

    expect(raiseQuery).toHaveBeenCalledWith({
      category: 'hostel',
      target_id: 'GANGA',
      subject: 'Early check-in',
      body: 'My train arrives on the 8th.',
    });
    expect(await screen.findByText('Query sent')).toBeInTheDocument();
  });

  it('omits target_id for a general query rather than sending null', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('No questions yet');

    await user.click(screen.getByRole('button', { name: /Ask a question/ }));
    await user.selectOptions(screen.getByLabelText(/What is this about/), 'general');
    // A general query names nothing, so the second dropdown is not even rendered.
    expect(screen.queryByLabelText(/^Which one\?/)).not.toBeInTheDocument();

    await user.click(screen.getByLabelText(/^Title/));
    await user.paste('Lost my institute ID');
    await user.click(screen.getByLabelText(/^Your question/));
    await user.paste('Where do I collect a replacement?');
    await user.click(screen.getByRole('button', { name: /Send to the team/ }));

    expect(raiseQuery).toHaveBeenCalledWith({
      category: 'general',
      subject: 'Lost my institute ID',
      body: 'Where do I collect a replacement?',
    });
  });

  it('refuses an incomplete draft on the device rather than on a 422', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('No questions yet');

    await user.click(screen.getByRole('button', { name: /Ask a question/ }));
    await user.click(screen.getByRole('button', { name: /Send to the team/ }));

    expect(raiseQuery).not.toHaveBeenCalled();
    expect(screen.getByText('Choose what this is about.')).toBeInTheDocument();
  });

  it('names who will read it before it is sent', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('No questions yet');

    await user.click(screen.getByRole('button', { name: /Ask a question/ }));
    await user.selectOptions(screen.getByLabelText(/What is this about/), 'hostel');
    expect(screen.getByText(/Goes to your block/)).toBeInTheDocument();
  });

  it('shows a raised query with its status and what it is about', async () => {
    myQueries.mockResolvedValue([record()]);
    renderPage();

    expect(await screen.findByText('Can I check in a day early?')).toBeInTheDocument();
    expect(screen.getByText('Open')).toBeInTheDocument();
    expect(screen.getByText('Ganga Block')).toBeInTheDocument();
    expect(screen.getByText('No reply yet.')).toBeInTheDocument();
  });

  it('shows a staff reply, which is the whole point of tracking one', async () => {
    myQueries.mockResolvedValue([
      record({
        status: 'resolved',
        assigned_team: 'Ganga Block desk',
        replies: [
          {
            author_id: 'BT1',
            author_type: 'staff',
            author_name: 'Block Coordinator',
            body: 'Yes — report to the desk after 6pm on the 8th.',
            timestamp: '2026-08-20T11:00:00',
          },
        ],
      }),
    ]);
    renderPage();

    expect(
      await screen.findByText('Yes — report to the desk after 6pm on the 8th.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Block Coordinator')).toBeInTheDocument();
    expect(screen.getByText('Ganga Block desk')).toBeInTheDocument();

    // "Answered" is also a summary card label, so this asserts the *badge* on the
    // thread rather than whichever one the DOM happened to reach first.
    const thread = screen.getByRole('article');
    expect(within(thread).getByText('Answered')).toBeInTheDocument();
  });

  // The figures moved up to `SupportPage`, where they are counted across both
  // questions and reports — see `SupportPage.test.tsx` and `supportCounts.test.ts`.

  it('lets the asker add to their own thread', async () => {
    const user = userEvent.setup();
    myQueries.mockResolvedValue([record()]);
    replyToQuery.mockResolvedValue({
      message: 'Reply added',
      reply: {
        author_id: 'DS23F1000042',
        author_type: 'participant',
        author_name: 'Meera R',
        body: 'Still waiting on this.',
        timestamp: '2026-08-20T12:00:00',
      },
    });
    renderPage();
    await screen.findByText('Can I check in a day early?');

    await user.click(screen.getByPlaceholderText('Add something to this question…'));
    await user.paste('Still waiting on this.');
    await user.click(screen.getByRole('button', { name: /Send reply/ }));

    expect(replyToQuery).toHaveBeenCalledWith('QRY20260820ABCDEF', {
      body: 'Still waiting on this.',
    });
    expect(await screen.findByText('Still waiting on this.')).toBeInTheDocument();
  });

  it('reports a failed load instead of an empty screen', async () => {
    const { ApiClientError } = await import('@/api');
    myQueries.mockRejectedValue(new ApiClientError(500, 'Internal Server Error'));
    renderPage();
    expect(await screen.findByText('Could not load your queries')).toBeInTheDocument();
  });

  it('still lets a general query be raised when every catalogue read fails', async () => {
    // Only `/queries/mine` is fatal. A participant whose hostel read failed must
    // still be able to reach the core team.
    const { ApiClientError } = await import('@/api');
    const boom = new ApiClientError(500, 'nope');
    listEvents.mockRejectedValue(boom);
    listHostels.mockRejectedValue(boom);
    myHostel.mockRejectedValue(boom);
    myMess.mockRejectedValue(boom);
    myEventRegistrations.mockRejectedValue(boom);

    const user = userEvent.setup();
    renderPage();
    await screen.findByText('No questions yet');

    await user.click(screen.getByRole('button', { name: /Ask a question/ }));
    const offered = within(screen.getByLabelText(/What is this about/))
      .getAllByRole('option')
      .map((option) => option.textContent);
    expect(offered).toContain('Something else');
  });

  it('hands a fault to the Report tab rather than pretending to be one', async () => {
    // This used to be a link to `/app/report-issue`. Now that the two are tabs of
    // one section it switches tab instead, which is the point of consolidating
    // them: the half-typed question does not get thrown away on the way.
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('No questions yet');

    await user.click(screen.getByRole('button', { name: /maintenance report/ }));
    expect(onReportInstead).toHaveBeenCalledTimes(1);
  });

  it('offers a way in from the empty state, not only from the section header', async () => {
    // The old screen kept its only "Ask a question" button in the page header,
    // far above an empty state that offered nothing — which is most of why this
    // read as an unbuilt feature to somebody opening it for the first time.
    const user = userEvent.setup();
    renderPage();

    const empty = await screen.findByText('No questions yet');
    expect(empty).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Ask a question/ }));
    expect(screen.getByLabelText(/What is this about/)).toBeInTheDocument();
  });
});
