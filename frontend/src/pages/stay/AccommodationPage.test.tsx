import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { Hostel, Mess, MyHostelResponse, MyMessResponse } from '@/api/types';
import { ROUTES } from '@/config/routes';
import { useAuthStore } from '@/stores/authStore';
import {
  clearStayRecord,
  makeReceipt,
  readStayRecord,
  saveStayRecord,
} from '@/features/stay/stayChoice';
import { resolveMenu } from '@/features/mess/messMenu';

const myHostel = vi.fn<() => Promise<MyHostelResponse>>();
const myMess = vi.fn<() => Promise<MyMessResponse>>();
const listHostels = vi.fn<() => Promise<Hostel[]>>();
const listMess = vi.fn<() => Promise<Mess[]>>();

vi.mock('@/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api')>();
  return {
    ...actual,
    api: {
      myHostel: () => myHostel(),
      myMess: () => myMess(),
      listHostels: () => listHostels(),
      listMess: () => listMess(),
      cancelAccommodationRequest: () => Promise.resolve({ message: 'ok' }),
    },
  };
});

const { default: AccommodationPage } = await import('./AccommodationPage');

const PARTICIPANT_ID = 'DS23F1000042';

const NILGIRI: Hostel = {
  hostel_id: 'H-NIL',
  name: 'Nilgiri Block',
  capacity: 300,
  gender: 'male',
  category: "Men's block",
};

const ALAKANANDA: Mess = {
  mess_id: 'M-ALK',
  name: 'Alakananda Hall',
  capacity: 500,
  type: 'south_indian__veg',
};

const UNALLOCATED: MyHostelResponse = {
  assigned_hostel: null,
  room: null,
  inside: false,
  registered: false,
  volunteers: [],
};

const NO_MESS: MyMessResponse = { allotted_mess: null, mess_details: null, slots: [] };

/** One `GET /mess/my_mess` slot entry — the backend's real flat shape. */
function slotEntry(day: string, slot: 'breakfast' | 'lunch' | 'dinner', scanned: boolean) {
  return {
    day,
    slot,
    start_time: null,
    end_time: null,
    menu: null,
    scanned,
    scanned_at: null,
  };
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={[ROUTES.accommodation]}>
      <Routes>
        <Route path={ROUTES.accommodation} element={<AccommodationPage />} />
        <Route path={ROUTES.accommodationPayment} element={<p>Mock checkout</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('AccommodationPage', () => {
  beforeEach(() => {
    clearStayRecord(PARTICIPANT_ID);
    myHostel.mockResolvedValue(UNALLOCATED);
    myMess.mockResolvedValue(NO_MESS);
    listHostels.mockResolvedValue([NILGIRI]);
    listMess.mockResolvedValue([ALAKANANDA]);
    useAuthStore.getState().setParticipantSession({
      id: PARTICIPANT_ID,
      email: 'stay@ds.study.iitm.ac.in',
      access_token: 't',
      token_type: 'participant',
      full_name: 'Ishaan Rao',
      dob: null,
      house: 'Nilgiri House',
      gender: 'male',
      phone: null,
      country: null,
      state: null,
      city: null,
      address: null,
      program: null,
      course_stage: null,
      photo: null,
      public_key: null,
      mess_preference: 'south_indian__veg',
    });
  });

  it('offers all four choices with their fees before anything is booked', async () => {
    renderPage();
    expect(
      await screen.findByRole('radio', { name: /Accommodation and mess/ }),
    ).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Accommodation only/ })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Mess only/ })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Neither/ })).toBeInTheDocument();
    // Hostel 900 + mess 1200, from the fest's one demo price list.
    expect(
      screen.getByRole('button', { name: /Continue to payment · ₹2,100/ }),
    ).toBeInTheDocument();
  });

  it('records a paid choice and hands off to the checkout', async () => {
    renderPage();
    await userEvent.click(await screen.findByRole('radio', { name: /Accommodation only/ }));
    await userEvent.click(screen.getByRole('button', { name: /Continue to payment · ₹900/ }));

    expect(await screen.findByText('Mock checkout')).toBeInTheDocument();
    expect(readStayRecord(PARTICIPANT_ID)).toMatchObject({
      choice: 'accommodation',
      receipt: null,
    });
  });

  it('settles "neither" on the spot, with no checkout and nothing to pay', async () => {
    renderPage();
    await userEvent.click(await screen.findByRole('radio', { name: /Neither/ }));
    await userEvent.click(screen.getByRole('button', { name: /Confirm — nothing to pay/ }));

    expect(await screen.findByText('Nothing booked')).toBeInTheDocument();
    expect(screen.queryByText('Mock checkout')).not.toBeInTheDocument();
    expect(readStayRecord(PARTICIPANT_ID)?.choice).toBe('neither');
  });

  it('explains that a paid booking is waiting on the allocation batch', async () => {
    saveStayRecord(PARTICIPANT_ID, {
      choice: 'both',
      decided_at: '2026-08-19T00:00:00.000Z',
      receipt: {
        reference: 'PDX-MOCK-ABC123',
        method: 'upi',
        paid_at: '2026-08-19T00:05:00.000Z',
        items: [{ facility: 'accommodation', label: 'Hostel accommodation', amount: 900 }],
        total: 900,
      },
    });
    myHostel.mockResolvedValue({ ...UNALLOCATED, registered: true });

    renderPage();

    expect(await screen.findByText('Allocation in progress')).toBeInTheDocument();
    expect(screen.getByText('Bed reserved — awaiting allocation')).toBeInTheDocument();
    // Only blocks the allocation batch would actually consider for this student.
    expect(screen.getByText('Nilgiri Block')).toBeInTheDocument();
    expect(screen.getByText('Alakananda Hall')).toBeInTheDocument();
    expect(screen.getByText('PDX-MOCK-ABC123', { exact: false })).toBeInTheDocument();
  });

  it('shows the block, room and hall once both batches have run', async () => {
    myHostel.mockResolvedValue({
      assigned_hostel: 'H-NIL',
      room: '104',
      inside: true,
      registered: true,
      volunteers: [{ name: 'Rahul', phone: '9876543210' }],
    });
    myMess.mockResolvedValue({
      allotted_mess: 'M-ALK',
      mess_details: ALAKANANDA,
      slots: [
        slotEntry('day_1', 'breakfast', true),
        slotEntry('day_1', 'lunch', false),
        slotEntry('day_1', 'dinner', false),
        slotEntry('day_2', 'breakfast', false),
        slotEntry('day_2', 'lunch', false),
        slotEntry('day_2', 'dinner', false),
      ],
    });

    renderPage();

    expect(await screen.findByText('Nilgiri Block')).toBeInTheDocument();
    expect(screen.getByText('104')).toBeInTheDocument();
    expect(screen.getByText('Inside the block')).toBeInTheDocument();
    expect(screen.getByText('Alakananda Hall')).toBeInTheDocument();
    // Shown twice once allocated: the hall's own "Serves" fact and the now-locked
    // "Meal preference" field both read the same combined type ("Veg · South
    // Indian") — realistic, since allocation only ever matches a hall to a
    // preference that equals it.
    expect(screen.getAllByText('Veg · South Indian')).toHaveLength(2);
    expect(screen.getByText('1 of 6')).toBeInTheDocument();
    expect(screen.getAllByText('Allotted')).toHaveLength(2);
    // Nothing is outstanding, so the picker is gone and the pass is offered.
    expect(screen.queryByRole('radio', { name: /Mess only/ })).not.toBeInTheDocument();
    expect(screen.getByText('Entry QR')).toBeInTheDocument();
  });
});

/* --------------------------------------------------- story 4.1: the menu --- */

/**
 * Story 4.1 is a *participant* story — "view mess menu and meal timings" — so it
 * is only delivered if the dishes and windows are readable on the screen a
 * student actually opens. The arithmetic behind them is covered by
 * `features/mess/messMenu.test.ts`; these assert the rendered panel, which is
 * what the story is about.
 */
describe('AccommodationPage — mess menu and meal timings (story 4.1)', () => {
  /** Allotted to Alakananda, with the five days of swipes the backend seeds. */
  const ALLOTTED: MyMessResponse = {
    allotted_mess: 'M-ALK',
    mess_details: ALAKANANDA,
    slots: Array.from({ length: 5 }, (_, i) =>
      (['breakfast', 'lunch', 'dinner'] as const).map((slot) =>
        slotEntry(`day_${i + 1}`, slot, false),
      ),
    ).flat(),
  };

  beforeEach(() => {
    localStorage.clear();
    clearStayRecord(PARTICIPANT_ID);
    myHostel.mockResolvedValue(UNALLOCATED);
    myMess.mockResolvedValue(ALLOTTED);
    listHostels.mockResolvedValue([NILGIRI]);
    listMess.mockResolvedValue([ALAKANANDA]);
    saveStayRecord(PARTICIPANT_ID, {
      choice: 'mess',
      decided_at: new Date().toISOString(),
      receipt: makeReceipt('mess', 'upi'),
    });
    useAuthStore.getState().setParticipantSession({
      id: PARTICIPANT_ID,
      email: 'stay@ds.study.iitm.ac.in',
      access_token: 't',
      token_type: 'participant',
      full_name: 'Ishaan Rao',
      dob: null,
      house: 'Nilgiri House',
      gender: 'male',
      phone: null,
      country: null,
      state: null,
      city: null,
      address: null,
      program: null,
      course_stage: null,
      photo: null,
      public_key: null,
      mess_preference: 'south_indian__veg',
    });
  });

  it('shows the menu with all three meal timings', async () => {
    renderPage();
    expect(await screen.findByText('Menu and meal timings')).toBeInTheDocument();
    // The windows, spelled out rather than left as raw 24-hour values.
    expect(screen.getByText(/Breakfast · 7:00 am – 9:00 am/)).toBeInTheDocument();
    expect(screen.getByText(/Lunch · 12:00 pm – 2:00 pm/)).toBeInTheDocument();
    expect(screen.getByText(/Dinner · 7:00 pm – 9:00 pm/)).toBeInTheDocument();
  });

  it('offers all six fest days, 9-14 June', async () => {
    renderPage();
    const days = await screen.findByRole('tablist', { name: 'Fest day' });
    for (let d = 1; d <= 6; d += 1) {
      expect(within(days).getByRole('tab', { name: new RegExp(`Day ${d}`) })).toBeInTheDocument();
    }
    expect(within(days).queryByRole('tab', { name: /Day 7/ })).not.toBeInTheDocument();
  });

  it('names real dishes instead of the old "Menu not recorded"', async () => {
    const user = userEvent.setup();
    renderPage();
    const days = await screen.findByRole('tablist', { name: 'Fest day' });
    // Pinned: the board opens on today's fest day, so leaving it to the clock
    // would make this assert a different day depending on when it runs.
    await user.click(within(days).getByRole('tab', { name: /Day 1/ }));

    expect(screen.queryByText('Menu not recorded')).not.toBeInTheDocument();

    // Asserted through the resolver so the test states the contract — "what the
    // published sheet says" — rather than carrying a copy of the data.
    const day1 = resolveMenu(ALAKANANDA, null).days[0];
    expect(screen.getByText(day1.breakfast[0])).toBeInTheDocument();
    expect(screen.getByText(day1.lunch[0])).toBeInTheDocument();
    expect(screen.getByText(day1.dinner[0])).toBeInTheDocument();
  });

  it('carries the standing accompaniments served at every sitting', async () => {
    renderPage();
    expect(await screen.findByText('Menu and meal timings')).toBeInTheDocument();
    expect(screen.getAllByText('Always served').length).toBe(3);
  });

  it('switches day, and the dishes switch with it', async () => {
    const user = userEvent.setup();
    renderPage();
    const days = await screen.findByRole('tablist', { name: 'Fest day' });

    const menu = resolveMenu(ALAKANANDA, null);

    await user.click(within(days).getByRole('tab', { name: /Day 1/ }));
    expect(screen.getByText(menu.days[0].dinner[0])).toBeInTheDocument();

    await user.click(within(days).getByRole('tab', { name: /Day 3/ }));
    expect(screen.getByText(menu.days[2].dinner[0])).toBeInTheDocument();
  });

  it('reads the hall’s own published menu, not the campus sheet, when it has one', async () => {
    listMess.mockResolvedValue([
      {
        ...ALAKANANDA,
        menu: {
          days: [
            {
              day: 1,
              slots: [
                {
                  slot: 'dinner',
                  start_time: '19:30',
                  end_time: '21:30',
                  dishes: ['Hall Biryani'],
                },
              ],
            },
          ],
          note: 'Dinner runs late tonight.',
        },
      },
    ]);
    myMess.mockResolvedValue({
      ...ALLOTTED,
      mess_details: {
        ...ALAKANANDA,
        menu: {
          days: [
            {
              day: 1,
              slots: [
                {
                  slot: 'dinner',
                  start_time: '19:30',
                  end_time: '21:30',
                  dishes: ['Hall Biryani'],
                },
              ],
            },
          ],
          note: 'Dinner runs late tonight.',
        },
      },
    });

    const user = userEvent.setup();
    renderPage();
    const days = await screen.findByRole('tablist', { name: 'Fest day' });
    await user.click(within(days).getByRole('tab', { name: /Day 1/ }));

    expect(screen.getByText('Hall Biryani')).toBeInTheDocument();
    // The hall's window replaces the fest-wide default, and its notice is shown.
    expect(screen.getByText(/Dinner · 7:30 pm – 9:30 pm/)).toBeInTheDocument();
    expect(screen.getByText('Dinner runs late tonight.')).toBeInTheDocument();
  });

  it('warns that day 6 has a menu but no swipe on the pass', async () => {
    const user = userEvent.setup();
    renderPage();
    const days = await screen.findByRole('tablist', { name: 'Fest day' });
    await user.click(within(days).getByRole('tab', { name: /Day 6/ }));

    // `mess.entries` is seeded with five days; the sixth is on the schedule.
    expect(screen.getByText(/no entry to log against it/)).toBeInTheDocument();
  });

  it('says the jain menu is an approximation rather than implying a guarantee', async () => {
    const jain: Mess = { ...ALAKANANDA, type: 'jain' };
    listMess.mockResolvedValue([jain]);
    myMess.mockResolvedValue({ ...ALLOTTED, mess_details: jain });

    renderPage();
    expect(
      await screen.findByText(/closest sheet the campus kitchen publishes/),
    ).toBeInTheDocument();
  });

  it('shows no menu at all to a student who is not allotted a hall', async () => {
    clearStayRecord(PARTICIPANT_ID);
    myMess.mockResolvedValue(NO_MESS);
    renderPage();
    expect(await screen.findByRole('radio', { name: /Mess only/ })).toBeInTheDocument();
    expect(screen.queryByText('Menu and meal timings')).not.toBeInTheDocument();
  });
});
