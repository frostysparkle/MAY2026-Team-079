import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ROUTES } from '@/config/routes';
import { useAuthStore } from '@/stores/authStore';
import { clearStayRecord, readStayRecord, saveStayRecord } from '@/features/stay/stayChoice';
import type { MockPaymentRequest, MockPaymentResponse } from '@/api/types';

const registerForAccommodation = vi.fn<() => Promise<{ message: string }>>();
const payHostel = vi.fn<(req: MockPaymentRequest) => Promise<MockPaymentResponse>>();
const payMess = vi.fn<(req: MockPaymentRequest) => Promise<MockPaymentResponse>>();

function paymentResponse(prefix: string, amount: number, method: string): MockPaymentResponse {
  return {
    paid: true,
    transaction_id: `PDX-${prefix}-${Math.random().toString(16).slice(2, 10).toUpperCase()}`,
    amount,
    method,
    paid_at: new Date().toISOString(),
  };
}

vi.mock('@/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api')>();
  return {
    ...actual,
    api: {
      registerForAccommodation: () => registerForAccommodation(),
      payHostel: (req: MockPaymentRequest) => payHostel(req),
      payMess: (req: MockPaymentRequest) => payMess(req),
    },
  };
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
    payHostel.mockImplementation((req) =>
      Promise.resolve(paymentResponse('HOSTEL', 900, req.method ?? 'upi')),
    );
    payMess.mockImplementation((req) =>
      Promise.resolve(paymentResponse('MESS', 1200, req.method ?? 'upi')),
    );
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

  it('settles both facilities against the real API and opts into the hostel queue', async () => {
    pending('both');
    renderPage();

    await userEvent.click(screen.getByRole('button', { name: /Pay ₹2,100/ }));

    expect(await screen.findByText('Stay hub')).toBeInTheDocument();
    expect(payHostel).toHaveBeenCalledWith({ method: 'upi' });
    expect(payMess).toHaveBeenCalledWith({ method: 'upi' });
    expect(registerForAccommodation).toHaveBeenCalledTimes(1);
    const record = readStayRecord(PARTICIPANT_ID);
    expect(record?.receipt?.total).toBe(2100);
    expect(record?.receipt?.method).toBe('upi');
    // Both transaction ids, joined — one call to /hostels/pay, one to /mess/pay.
    expect(record?.receipt?.reference).toMatch(/^PDX-HOSTEL-[0-9A-F]+ · PDX-MESS-[0-9A-F]+$/);
  });

  it('leaves the hostel queue alone, and calls only /mess/pay, for a mess-only booking', async () => {
    pending('mess');
    renderPage();

    await userEvent.click(screen.getByRole('button', { name: /Pay ₹1,200/ }));

    expect(await screen.findByText('Stay hub')).toBeInTheDocument();
    expect(payMess).toHaveBeenCalledWith({ method: 'upi' });
    expect(payHostel).not.toHaveBeenCalled();
    expect(registerForAccommodation).not.toHaveBeenCalled();
    const record = readStayRecord(PARTICIPANT_ID);
    expect(record?.receipt?.total).toBe(1200);
    expect(record?.receipt?.reference).toMatch(/^PDX-MESS-[0-9A-F]+$/);
  });

  it('calls only /hostels/pay for an accommodation-only booking', async () => {
    pending('accommodation');
    renderPage();

    await userEvent.click(screen.getByRole('button', { name: /Pay ₹900/ }));

    expect(await screen.findByText('Stay hub')).toBeInTheDocument();
    expect(payHostel).toHaveBeenCalledWith({ method: 'upi' });
    expect(payMess).not.toHaveBeenCalled();
    expect(readStayRecord(PARTICIPANT_ID)?.receipt?.reference).toMatch(/^PDX-HOSTEL-[0-9A-F]+$/);
  });

  it('does not register for accommodation when the mess payment itself fails', async () => {
    pending('both');
    payMess.mockRejectedValue(new ApiClientError(503, 'Service unavailable'));
    renderPage();

    await userEvent.click(screen.getByRole('button', { name: /Pay ₹2,100/ }));

    expect(await screen.findByText('Payment could not be completed')).toBeInTheDocument();
    expect(registerForAccommodation).not.toHaveBeenCalled();
    expect(readStayRecord(PARTICIPANT_ID)?.receipt).toBeNull();
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
