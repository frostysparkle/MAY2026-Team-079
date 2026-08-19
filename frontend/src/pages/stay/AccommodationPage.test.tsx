import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { Hostel, Mess, MyHostelResponse, MyMessResponse } from '@/api/types';
import { ROUTES } from '@/config/routes';
import { useAuthStore } from '@/stores/authStore';
import { clearStayRecord, readStayRecord, saveStayRecord } from '@/features/stay/stayChoice';

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
  preference: 'veg',
  cuisines: ['south_indian'],
};

const UNALLOCATED: MyHostelResponse = {
  assigned_hostel: null,
  room: null,
  logged_in: false,
  registered: false,
  volunteers: [],
};

const NO_MESS: MyMessResponse = { allotted_mess: null, mess_details: null, slots: [] };

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
      mess_preference: 'veg',
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
      logged_in: true,
      registered: true,
      volunteers: [{ name: 'Rahul', phone: '9876543210' }],
    });
    myMess.mockResolvedValue({
      allotted_mess: 'M-ALK',
      mess_details: ALAKANANDA,
      slots: [
        { breakfast: { logged: true }, lunch: { logged: false }, dinner: { logged: false } },
        { breakfast: { logged: false }, lunch: { logged: false }, dinner: { logged: false } },
      ],
    });

    renderPage();

    expect(await screen.findByText('Nilgiri Block')).toBeInTheDocument();
    expect(screen.getByText('104')).toBeInTheDocument();
    expect(screen.getByText('Inside the block')).toBeInTheDocument();
    expect(screen.getByText('Alakananda Hall')).toBeInTheDocument();
    expect(screen.getByText('Veg · South Indian')).toBeInTheDocument();
    expect(screen.getByText('1 of 6')).toBeInTheDocument();
    expect(screen.getAllByText('Allotted')).toHaveLength(2);
    // Nothing is outstanding, so the picker is gone and the pass is offered.
    expect(screen.queryByRole('radio', { name: /Mess only/ })).not.toBeInTheDocument();
    expect(screen.getByText('Entry QR')).toBeInTheDocument();
  });
});
