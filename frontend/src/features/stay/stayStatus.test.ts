import { describe, it, expect } from 'vitest';
import { deriveStayStatus } from './stayStatus';
import type { StayRecord } from './stayChoice';
import type { MyHostelResponse, MyMessResponse } from '@/api/types';

const NO_HOSTEL: MyHostelResponse = {
  assigned_hostel: null,
  room: null,
  logged_in: false,
  registered: false,
  volunteers: [],
};

const REQUESTED_HOSTEL: MyHostelResponse = { ...NO_HOSTEL, registered: true };

const ALLOTTED_HOSTEL: MyHostelResponse = {
  assigned_hostel: 'H-NIL',
  room: '104',
  logged_in: true,
  registered: true,
  volunteers: [{ name: 'Rahul', phone: '9876543210' }],
};

const NO_MESS: MyMessResponse = { allotted_mess: null, mess_details: null, slots: [] };
const ALLOTTED_MESS: MyMessResponse = { allotted_mess: 'M-ALK', mess_details: null, slots: [] };

const record = (over: Partial<StayRecord> = {}): StayRecord => ({
  choice: 'both',
  decided_at: '2026-08-19T00:00:00.000Z',
  receipt: null,
  ...over,
});

const PAID = {
  reference: 'PDX-MOCK-ABC123',
  method: 'upi',
  paid_at: '2026-08-19T00:05:00.000Z',
  items: [],
  total: 2100,
};

describe('deriveStayStatus', () => {
  it('has nothing to say when neither the device nor the server records a decision', () => {
    const status = deriveStayStatus(null, NO_HOSTEL, NO_MESS);
    expect(status.choice).toBeNull();
    expect(status.paid).toBe(false);
    expect(status.accommodation).toBe('not_selected');
    expect(status.mess).toBe('not_selected');
    expect(status.awaitingAllocation).toBe(false);
  });

  it('holds an unpaid selection at the payment step', () => {
    const status = deriveStayStatus(record(), NO_HOSTEL, NO_MESS);
    expect(status.paid).toBe(false);
    expect(status.accommodation).toBe('awaiting_payment');
    expect(status.mess).toBe('awaiting_payment');
    expect(status.awaitingAllocation).toBe(false);
  });

  it('waits on the allocation batch once the fee is settled', () => {
    const status = deriveStayStatus(record({ receipt: PAID }), REQUESTED_HOSTEL, NO_MESS);
    expect(status.accommodation).toBe('awaiting_allocation');
    expect(status.mess).toBe('awaiting_allocation');
    expect(status.awaitingAllocation).toBe(true);
  });

  it('reports each half independently as its batch lands', () => {
    const status = deriveStayStatus(record({ receipt: PAID }), ALLOTTED_HOSTEL, NO_MESS);
    expect(status.accommodation).toBe('allocated');
    expect(status.mess).toBe('awaiting_allocation');
    expect(status.awaitingAllocation).toBe(true);
  });

  it('stops polling once everything paid for has been placed', () => {
    const status = deriveStayStatus(record({ receipt: PAID }), ALLOTTED_HOSTEL, ALLOTTED_MESS);
    expect(status.awaitingAllocation).toBe(false);
  });

  // A student the organisers placed by hand, or one signing in on a second
  // device, has no local record — the server's answer has to be enough.
  it('reads a server-side placement as a settled booking with no local record', () => {
    const status = deriveStayStatus(null, ALLOTTED_HOSTEL, ALLOTTED_MESS);
    expect(status.choice).toBe('both');
    expect(status.paid).toBe(true);
    expect(status.accommodation).toBe('allocated');
    expect(status.mess).toBe('allocated');
  });

  it('treats a pending server-side request alone as accommodation only', () => {
    const status = deriveStayStatus(null, REQUESTED_HOSTEL, NO_MESS);
    expect(status.choice).toBe('accommodation');
    expect(status.paid).toBe(true);
    expect(status.accommodation).toBe('awaiting_allocation');
    expect(status.mess).toBe('not_selected');
  });

  it('leaves "neither" with nothing outstanding', () => {
    const status = deriveStayStatus(record({ choice: 'neither' }), NO_HOSTEL, NO_MESS);
    expect(status.choice).toBe('neither');
    expect(status.accommodation).toBe('not_selected');
    expect(status.mess).toBe('not_selected');
    expect(status.awaitingAllocation).toBe(false);
  });

  // The mess batch places every participant who has no hall yet, opt-in or not,
  // so a hall can appear against a choice that never asked for one. Having one
  // is the truer answer than the selection that predates it.
  it('shows a hall the mess batch handed out regardless of the selection', () => {
    const status = deriveStayStatus(
      record({ choice: 'accommodation', receipt: PAID }),
      ALLOTTED_HOSTEL,
      ALLOTTED_MESS,
    );
    expect(status.mess).toBe('allocated');
  });
});
