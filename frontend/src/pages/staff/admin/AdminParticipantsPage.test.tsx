import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type {
  Hostel,
  ParticipantAdminUpdateRequest,
  ParticipantFilter,
  ParticipantListResponse,
  ParticipantRecord,
  ParticipantStatisticsResponse,
  ParticipantUpdateResponse,
} from '@/api/types';

/**
 * Story 7.3 — the one screen that can correct somebody else's record.
 *
 * The interesting assertions are about restraint: only what changed is sent,
 * clearing a field is refused rather than saved as a deletion, and identity and
 * allocation are visible but not editable.
 */

const listParticipants =
  vi.fn<(filter?: ParticipantFilter, limit?: number) => Promise<ParticipantListResponse>>();
const updateParticipant =
  vi.fn<(id: string, req: ParticipantAdminUpdateRequest) => Promise<ParticipantUpdateResponse>>();
/** Read only for `by_house` — the House filter's vocabulary. */
const participantStatistics = vi.fn<() => Promise<ParticipantStatisticsResponse>>();
/** Read only to turn `accommodation.hostel_id` into a block name. */
const listHostels = vi.fn<() => Promise<Hostel[]>>();

vi.mock('@/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api')>();
  return {
    ...actual,
    api: {
      listParticipants: (filter?: ParticipantFilter, limit?: number) =>
        listParticipants(filter, limit),
      updateParticipant: (id: string, req: ParticipantAdminUpdateRequest) =>
        updateParticipant(id, req),
      participantStatistics: () => participantStatistics(),
      listHostels: () => listHostels(),
    },
  };
});

const { default: AdminParticipantsPage } = await import('./AdminParticipantsPage');

const MEERA: ParticipantRecord = {
  participant_id: 'DS23F1000042',
  email: '23f1000042@ds.study.iitm.ac.in',
  profile: {
    full_name: 'Meera Raghunathan',
    house: 'Ganga',
    gender: 'female',
    phone: '9000000001',
    country: 'India',
    state: 'TN',
    city: 'Chennai',
    address: 'IITM',
    program: 'DS',
    course_stage: 'diploma',
  },
  // A block *code*, which is all a participant record carries: `GET /participants`
  // returns `accommodation` verbatim and never joins the hostel catalogue. The
  // name the roster shows comes from `HOSTELS` below.
  accommodation: { hostel_id: 'HS01', room: '214', inside: true, registered: true },
  mess: { mess_id: 'NILGIRI', registered: true },
  event_count: 2,
  workshop_count: 1,
} as ParticipantRecord;

const ARJUN: ParticipantRecord = {
  participant_id: 'DS23F1000099',
  email: '23f1000099@ds.study.iitm.ac.in',
  // Registered but never completed a profile — the `{}` state.
  profile: {},
  event_count: 0,
  workshop_count: 0,
} as ParticipantRecord;

/**
 * The block catalogue, as `GET /hostels` returns it.
 *
 * Ids and names taken from the seeded catalogue, where `HS01` is Alakananda. The
 * name is deliberately nothing like Meera's house (`Ganga`), so a test asserting
 * on the Stay column cannot pass by accident on the House column's text.
 */
const HOSTELS: Hostel[] = [
  { hostel_id: 'HS01', name: 'Alakananda', capacity: 300, gender: 'male' },
  { hostel_id: 'HS04', name: 'Ganga', capacity: 300, gender: 'male' },
];

/**
 * Fest-wide counts, which feed both the House filter's vocabulary and the four
 * stat cards.
 *
 * Three houses, and only one of them (`Ganga`) is a house any fixture above is
 * in — which is what lets a test tell a vocabulary derived from the loaded roster
 * apart from one counted across the whole fest.
 *
 * Every figure here is deliberately larger than, and different from, what the
 * two-row roster fixture would produce. That is the whole point: the cards must
 * report the collection rather than the page they happen to be holding, so a card
 * showing `1` or `2` is showing the roster and is wrong. `by_house` sums to
 * `profile_complete` rather than `total_registered`, as the real endpoint's
 * `by_*` splits do.
 */
function statistics(): ParticipantStatisticsResponse {
  return {
    total_registered: 15,
    profile_complete: 12,
    profile_incomplete: 3,
    mess_registered: 8,
    mess_allotted: 7,
    hostel_registered: 10,
    hostel_allotted: 9,
    hostel_pending: 1,
    currently_on_campus: 4,
    with_event_registrations: 6,
    with_workshop_registrations: 5,
    by_house: { Ganga: 1, Kaveri: 4, Narmada: 7 },
    by_program: {},
    by_course_stage: {},
    by_gender: {},
    signups_by_day: {},
  };
}

function renderPage() {
  return render(
    <MemoryRouter>
      <AdminParticipantsPage />
    </MemoryRouter>,
  );
}

/**
 * The Edit button on one named person's row.
 *
 * Picked by row rather than by index: the table sorts by display name, and
 * somebody with no profile sorts under their id — so the first row is not the
 * first fixture, and an index would silently test the wrong record.
 */
function editButtonFor(name: string) {
  const row = screen.getByText(name).closest('tr');
  if (!row) throw new Error(`No row for ${name}`);
  return within(row as HTMLElement).getByRole('button', { name: /Edit/ });
}

describe('AdminParticipantsPage', () => {
  beforeEach(() => {
    listParticipants.mockResolvedValue({ count: 2, participants: [MEERA, ARJUN] });
    updateParticipant.mockImplementation(async (_id, req) => ({
      message: 'Participant updated',
      profile: { ...MEERA.profile, ...req } as ParticipantUpdateResponse['profile'],
    }));
    participantStatistics.mockResolvedValue(statistics());
    listHostels.mockResolvedValue(HOSTELS);
  });

  it('lists every participant with their id, house, and placement', async () => {
    renderPage();
    expect(await screen.findByText('Meera Raghunathan')).toBeInTheDocument();
    const row = screen.getByText('Meera Raghunathan').closest('tr') as HTMLElement;
    expect(within(row).getByText('DS23F1000042')).toBeInTheDocument();
    // Scoped to the row: "Ganga" is also an option in the House filter.
    expect(within(row).getByText('Ganga')).toBeInTheDocument();
    // The block *name*, not the `HS01` the record actually holds.
    expect(await within(row).findByText('Alakananda · 214')).toBeInTheDocument();
    expect(within(row).queryByText(/HS01/)).not.toBeInTheDocument();
  });

  it('spells out the registration counts rather than abbreviating them', async () => {
    renderPage();
    await screen.findByText('Meera Raghunathan');

    // Meera has 2 and 1, so this covers the plural and the singular in one row.
    const meera = screen.getByText('Meera Raghunathan').closest('tr') as HTMLElement;
    expect(within(meera).getByText('2 events · 1 workshop')).toBeInTheDocument();

    // Arjun has neither, and zero pluralises.
    const arjun = screen.getAllByText('DS23F1000099')[0].closest('tr') as HTMLElement;
    expect(within(arjun).getByText('0 events · 0 workshops')).toBeInTheDocument();

    // The `ev` / `ws` shorthand nobody could decode is gone.
    expect(screen.queryByText(/\bev\b|\bws\b/)).not.toBeInTheDocument();
  });

  it('falls back to the block code when the catalogue cannot be read', async () => {
    // Losing the catalogue costs the names and leaves the ids, which is what this
    // column showed before it looked them up — not a reason to fail the roster.
    const { ApiClientError } = await import('@/api');
    listHostels.mockRejectedValue(new ApiClientError(500, 'boom'));

    renderPage();
    const row = (await screen.findByText('Meera Raghunathan')).closest('tr') as HTMLElement;
    expect(within(row).getByText('HS01 · 214')).toBeInTheDocument();
  });

  it('names somebody with no profile by their id rather than leaving the row blank', async () => {
    renderPage();
    await screen.findByText('Meera Raghunathan');
    // Once in the ID column, once as the display name.
    expect(screen.getAllByText('DS23F1000099').length).toBeGreaterThan(1);
    expect(screen.getByText('Needs detail')).toBeInTheDocument();
  });

  /**
   * The cards report the fest, not the page.
   *
   * They used to be `.length` and loop counts over the loaded roster, which is
   * capped at 200 — so on a real fest "Registered" pinned to exactly 200 and the
   * other three reported the first 200 rows' share of the collection. The roster
   * fixture here holds two people while `statistics()` describes fifteen, so any
   * card that has gone back to counting the page fails these assertions.
   */
  it('reports fest-wide totals on the cards rather than the loaded page', async () => {
    renderPage();

    const registered = await screen.findByRole('group', { name: 'Registered' });
    expect(within(registered).getByText('15')).toBeInTheDocument();
    expect(within(registered).getByText('across the whole fest')).toBeInTheDocument();

    const complete = screen.getByRole('group', { name: 'Profile complete' });
    expect(within(complete).getByText('12')).toBeInTheDocument();
    expect(within(complete).getByText('3 still to fill in')).toBeInTheDocument();

    expect(
      within(screen.getByRole('group', { name: 'In a block' })).getByText('9'),
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole('group', { name: 'In a hall' })).getByText('7'),
    ).toBeInTheDocument();
  });

  /**
   * A search changes the question to one the aggregate cannot answer — the
   * endpoint takes no `q` — so the cards fall back to counting the returned rows
   * and relabel themselves so nobody reads a filtered count as a fest total.
   */
  it('switches the cards to the matching rows once a search is applied', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('Meera Raghunathan');

    listParticipants.mockResolvedValue({ count: 1, participants: [MEERA] });
    await user.click(screen.getByLabelText('Search'));
    await user.paste('meera');
    await user.click(screen.getByRole('button', { name: /^Search/ }));

    const matching = await screen.findByRole('group', { name: 'Matching' });
    expect(within(matching).getByText('1')).toBeInTheDocument();
    // The fest-wide caption must be gone: this is one row, not the collection.
    expect(within(matching).queryByText('across the whole fest')).not.toBeInTheDocument();

    const complete = screen.getByRole('group', { name: 'Matching, profile complete' });
    expect(within(complete).getByText('1')).toBeInTheDocument();
    expect(within(complete).getByText('0 still to fill in')).toBeInTheDocument();
  });

  it('asks the server to search rather than filtering in the browser', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('Meera Raghunathan');

    await user.click(screen.getByLabelText('Search'));
    await user.paste('meera');
    await user.click(screen.getByRole('button', { name: /^Search/ }));

    expect(listParticipants).toHaveBeenLastCalledWith({ q: 'meera', house: undefined }, 200);
  });

  it('sends only the field that changed', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('Meera Raghunathan');

    await user.click(editButtonFor('Meera Raghunathan'));
    const phone = await screen.findByLabelText('Phone');
    await user.clear(phone);
    await user.paste('9111111111');
    await user.click(screen.getByRole('button', { name: /Save changes/ }));

    expect(updateParticipant).toHaveBeenCalledWith('DS23F1000042', { phone: '9111111111' });
    expect(await screen.findByText('Saved')).toBeInTheDocument();
  });

  it('will not save until something has actually changed', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('Meera Raghunathan');

    await user.click(editButtonFor('Meera Raghunathan'));
    expect(await screen.findByRole('button', { name: /Save changes/ })).toBeDisabled();
  });

  it('refuses to treat a cleared field as a deletion, and says why', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('Meera Raghunathan');

    await user.click(editButtonFor('Meera Raghunathan'));
    await user.clear(await screen.findByLabelText('Address'));

    expect(screen.getByText('Cleared fields are not saved')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Save changes/ })).toBeDisabled();
    expect(updateParticipant).not.toHaveBeenCalled();
  });

  it('shows identity and placement but offers no field for either', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('Meera Raghunathan');

    await user.click(editButtonFor('Meera Raghunathan'));
    await screen.findByLabelText('Phone');

    expect(screen.getByText(/neither is editable here/)).toBeInTheDocument();
    for (const forbidden of ['Email', 'Participant ID', 'Hostel', 'Room', 'Mess hall']) {
      expect(screen.queryByLabelText(forbidden)).not.toBeInTheDocument();
    }
  });

  it('keeps a stored value the dropdown does not list rather than coercing it', async () => {
    const user = userEvent.setup();
    listParticipants.mockResolvedValue({
      count: 1,
      // `Male`, not `male` — what an older profile might actually hold.
      participants: [{ ...MEERA, profile: { ...MEERA.profile, gender: 'Male' } }],
    });
    renderPage();
    await screen.findByText('Meera Raghunathan');

    await user.click(editButtonFor('Meera Raghunathan'));
    const gender = await screen.findByLabelText('Gender');
    expect(gender).toHaveValue('Male');
  });

  it('reports a failed save without claiming it worked', async () => {
    const user = userEvent.setup();
    const { ApiClientError } = await import('@/api');
    updateParticipant.mockRejectedValue(new ApiClientError(403, 'Not authorized'));
    renderPage();
    await screen.findByText('Meera Raghunathan');

    await user.click(editButtonFor('Meera Raghunathan'));
    const phone = await screen.findByLabelText('Phone');
    await user.clear(phone);
    await user.paste('9111111111');
    await user.click(screen.getByRole('button', { name: /Save changes/ }));

    expect(await screen.findByText('Not saved')).toBeInTheDocument();
    expect(screen.queryByText('Saved')).not.toBeInTheDocument();
  });

  it('reports a failed load with a retry', async () => {
    const { ApiClientError } = await import('@/api');
    listParticipants.mockRejectedValue(new ApiClientError(403, 'Not authorized'));
    renderPage();
    expect(await screen.findByText('Could not load participants')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('says nobody matches rather than showing an empty table', async () => {
    listParticipants.mockResolvedValue({ count: 0, participants: [] });
    renderPage();
    expect(await screen.findByText('No participants yet')).toBeInTheDocument();
  });

  /**
   * The House filter used to derive its options from the roster on screen, which
   * meant filtering by a house refetched a roster holding only that house and so
   * deleted every other option from the control that had just been used — a
   * one-shot filter an admin could only escape by clearing the search too. The
   * vocabulary now comes from `by_house`, which does not move when the filter
   * does. These are regression tests; the group above never touched the dropdown,
   * which is how the defect survived.
   */
  describe('house filter', () => {
    /** The House `<select>`'s option values, in DOM order. */
    function houseOptions() {
      const select = screen.getByLabelText('House') as HTMLSelectElement;
      return [...select.options].map((option) => option.value);
    }

    it('offers every house in the fest, not just those on the loaded page', async () => {
      renderPage();
      await screen.findByText('Meera Raghunathan');
      // `Kaveri` and `Narmada` are in no fixture, so a roster-derived list misses them.
      expect(houseOptions()).toEqual(['', 'Ganga', 'Kaveri', 'Narmada']);
    });

    it('asks the server to narrow by house', async () => {
      const user = userEvent.setup();
      renderPage();
      await screen.findByText('Meera Raghunathan');

      await user.selectOptions(screen.getByLabelText('House'), 'Kaveri');

      expect(listParticipants).toHaveBeenLastCalledWith({ q: undefined, house: 'Kaveri' }, 200);
    });

    it('still offers every house after one has been picked, so a second choice is possible', async () => {
      const user = userEvent.setup();
      renderPage();
      await screen.findByText('Meera Raghunathan');

      listParticipants.mockResolvedValue({ count: 1, participants: [MEERA] });
      await user.selectOptions(screen.getByLabelText('House'), 'Kaveri');
      await screen.findByText('Meera Raghunathan');

      expect(houseOptions()).toEqual(['', 'Ganga', 'Kaveri', 'Narmada']);
      expect(screen.getByLabelText('House')).toHaveValue('Kaveri');
    });

    it('keeps its options while the narrowed roster is still in flight', async () => {
      const user = userEvent.setup();
      renderPage();
      await screen.findByText('Meera Raghunathan');

      // Held open: `load` blanks the roster before fetching, and a vocabulary read
      // from that roster left the control with nothing but its placeholder — so it
      // displayed "Every house" while the state said otherwise.
      let release: (response: ParticipantListResponse) => void = () => {};
      listParticipants.mockImplementation(
        () => new Promise<ParticipantListResponse>((resolve) => (release = resolve)),
      );
      await user.selectOptions(screen.getByLabelText('House'), 'Narmada');

      expect(houseOptions()).toEqual(['', 'Ganga', 'Kaveri', 'Narmada']);
      expect(screen.getByLabelText('House')).toHaveValue('Narmada');

      release({ count: 0, participants: [] });
      expect(await screen.findByText('Nobody matches that')).toBeInTheDocument();
    });

    it('still offers every house after a text search narrows the roster', async () => {
      const user = userEvent.setup();
      renderPage();
      await screen.findByText('Meera Raghunathan');

      listParticipants.mockResolvedValue({ count: 1, participants: [MEERA] });
      await user.click(screen.getByLabelText('Search'));
      await user.paste('meera');
      await user.click(screen.getByRole('button', { name: /^Search/ }));
      await screen.findByText('Meera Raghunathan');

      expect(houseOptions()).toEqual(['', 'Ganga', 'Kaveri', 'Narmada']);
    });

    it('leaves the roster usable when the house counts cannot be read', async () => {
      const { ApiClientError } = await import('@/api');
      participantStatistics.mockRejectedValue(new ApiClientError(403, 'Not authorized'));
      renderPage();

      // The dropdown degrades to its placeholder rather than failing the screen:
      // the roster and its server-side search are the point, the filter is a
      // convenience.
      expect(await screen.findByText('Meera Raghunathan')).toBeInTheDocument();
      expect(houseOptions()).toEqual(['']);

      // The same response backs the stat cards, so they drop to counting the
      // loaded page and withdraw the fest-wide caption rather than showing a
      // total they can no longer stand behind.
      const registered = screen.getByRole('group', { name: 'Registered' });
      expect(within(registered).getByText('2')).toBeInTheDocument();
      expect(within(registered).queryByText('across the whole fest')).not.toBeInTheDocument();
    });
  });
});
