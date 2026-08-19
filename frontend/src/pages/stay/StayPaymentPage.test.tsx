import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ROUTES } from '@/config/routes';
import { useAuthStore } from '@/stores/authStore';
import { clearStayRecord, readStayRecord, saveStayRecord } from '@/features/stay/stayChoice';

const registerForAccommodation = vi.fn<() => Promise<{ message: string }>>();

vi.mock('@/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api')>();
  return { ...actual, api: { registerForAccommodation: () => registerForAccommodation() } };
});

const { default: StayPaymentPage } = await import('./StayPaymentPage');
const { ApiClientError } = await import('@/api');

const PARTICIPANT_ID = 'DS23F1000042';

function renderPage() {
  return render(
    <MemoryRouter initialEntries={[ROUTES.accommodationPayment]}>
      <Routes>
        <Route path={ROUTES.accommodationPayment} element={<StayPaymentPage />} />
        <Route path={ROUTES.accommodation} element={<p>Stay hub</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

/** A pending selection, as the hub leaves it just before handing off here. */
function pending(choice: 'both' | 'accommodation' | 'mess') {
  saveStayRecord(PARTICIPANT_ID, {
    choice,
    decided_at: '2026-08-19T00:00:00.000Z',
    receipt: null,
  });
}

describe('StayPaymentPage', () => {
  beforeEach(() => {
    clearStayRecord(PARTICIPANT_ID);
    registerForAccommodation.mockResolvedValue({ message: 'Accommodation requested' });
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
    });
  });

  it('itemises the selection and says plainly that the gateway is simulated', () => {
    pending('both');
    renderPage();

    expect(screen.getByText('Hostel accommodation')).toBeInTheDocument();
    expect(screen.getByText('Mess — all meals')).toBeInTheDocument();
    expect(screen.getByText('₹2,100')).toBeInTheDocument();
    expect(screen.getByText('Simulated checkout')).toBeInTheDocument();
    // A realistic card form is the one part of a mock checkout that can mislead.
    expect(screen.queryByLabelText(/card number/i)).not.toBeInTheDocument();
  });

  it('opts the student into the real hostel queue when the mock payment settles', async () => {
    pending('both');
    renderPage();

    await userEvent.click(screen.getByRole('button', { name: /Pay ₹2,100/ }));

    expect(await screen.findByText('Stay hub')).toBeInTheDocument();
    expect(registerForAccommodation).toHaveBeenCalledTimes(1);
    const record = readStayRecord(PARTICIPANT_ID);
    expect(record?.receipt?.total).toBe(2100);
    expect(record?.receipt?.method).toBe('upi');
    expect(record?.receipt?.reference).toMatch(/^PDX-MOCK-[0-9A-F]{6}$/);
  });

  it('leaves the hostel queue alone for a mess-only booking', async () => {
    pending('mess');
    renderPage();

    await userEvent.click(screen.getByRole('button', { name: /Pay ₹1,200/ }));

    expect(await screen.findByText('Stay hub')).toBeInTheDocument();
    expect(registerForAccommodation).not.toHaveBeenCalled();
    expect(readStayRecord(PARTICIPANT_ID)?.receipt?.total).toBe(1200);
  });

  // Both 400 branches of POST /hostels/register mean "you already have this".
  it('treats an already-held place as a settled booking, not a failure', async () => {
    pending('accommodation');
    registerForAccommodation.mockRejectedValue(
      new ApiClientError(400, 'Accommodation already allotted'),
    );
    renderPage();

    await userEvent.click(screen.getByRole('button', { name: /Pay ₹900/ }));

    expect(await screen.findByText('Stay hub')).toBeInTheDocument();
    expect(readStayRecord(PARTICIPANT_ID)?.receipt?.total).toBe(900);
  });

  it('keeps the booking unpaid when the opt-in call genuinely fails', async () => {
    pending('accommodation');
    registerForAccommodation.mockRejectedValue(new ApiClientError(503, 'Service unavailable'));
    renderPage();

    await userEvent.click(screen.getByRole('button', { name: /Pay ₹900/ }));

    expect(await screen.findByText('Payment could not be completed')).toBeInTheDocument();
    expect(readStayRecord(PARTICIPANT_ID)?.receipt).toBeNull();
  });

  it('sends a student with nothing pending back to the hub', () => {
    renderPage();
    expect(screen.getByText('Stay hub')).toBeInTheDocument();
  });
});
