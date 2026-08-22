import { readWorkshopRegisterFailure } from './registerOutcome';
import { readSlotStatus } from './registrationCache';

describe('readWorkshopRegisterFailure', () => {
  it('classifies a slot clash and asks for the held slots to be re-read', () => {
    const outcome = readWorkshopRegisterFailure(
      'Already registered for another workshop in this time slot',
    );
    expect(outcome.kind).toBe('slot-clash');
    expect(outcome.tone).toBe('warning');
    expect(outcome.retryable).toBe(false);
    // The catalogue clearly did not know about the other booking, or this
    // workshop would have been greyed out before the tap.
    expect(outcome.refreshBookings).toBe(true);
  });

  it('classifies an existing booking as a success, not an error', () => {
    const outcome = readWorkshopRegisterFailure('Already registered for this workshop');
    expect(outcome.kind).toBe('already-registered');
    expect(outcome.tone).toBe('success');
    expect(outcome.retryable).toBe(false);
  });

  it('classifies a full workshop and asks for the seat count to be re-read', () => {
    const outcome = readWorkshopRegisterFailure('Workshop is full');
    expect(outcome.kind).toBe('full');
    expect(outcome.tone).toBe('error');
    expect(outcome.refreshSeats).toBe(true);
    expect(outcome.retryable).toBe(false);
  });

  it('classifies the race separately from a full workshop, and offers a retry', () => {
    // Both messages mention filling up; the race is the one worth trying again,
    // so the order of the checks matters and is asserted here.
    const outcome = readWorkshopRegisterFailure(
      'Failed to register. Workshop might have just filled up.',
    );
    expect(outcome.kind).toBe('race');
    expect(outcome.retryable).toBe(true);
    expect(outcome.refreshSeats).toBe(true);
  });

  it('falls back to the server’s own words for an unrecognised refusal', () => {
    const outcome = readWorkshopRegisterFailure('Some new backend rule');
    expect(outcome.kind).toBe('unknown');
    expect(outcome.tone).toBe('error');
    expect(outcome.title).toBe('Could not register');
    expect(outcome.description).toBe('Some new backend rule');
  });

  it('is insensitive to case and whitespace', () => {
    expect(readWorkshopRegisterFailure('  WORKSHOP IS FULL  ').kind).toBe('full');
    expect(readWorkshopRegisterFailure('Already Registered For This Workshop').kind).toBe(
      'already-registered',
    );
  });
});

describe('readSlotStatus', () => {
  const held = { '2026-06-11-morning': 'W1', '2026-06-12-afternoon': null };

  it('reports the workshop actually held in a slot as own', () => {
    expect(readSlotStatus(held, '2026-06-11-morning', 'W1')).toBe('own');
  });

  it('reports a different workshop in a held slot as a conflict', () => {
    expect(readSlotStatus(held, '2026-06-11-morning', 'W2')).toBe('conflict');
  });

  it('reports a free slot as none', () => {
    expect(readSlotStatus(held, '2026-06-13-morning', 'W3')).toBe('none');
    expect(readSlotStatus({}, '2026-06-11-morning', 'W1')).toBe('none');
  });

  it('still blocks a slot whose workshop was deleted after booking', () => {
    // `my_registrations` reports `workshop_id: null` for a deleted workshop but
    // keeps the slot, and the backend still counts it as occupied.
    expect(readSlotStatus(held, '2026-06-12-afternoon', 'W9')).toBe('conflict');
  });

  it('treats an empty slot id as unknown rather than matching everything', () => {
    // A hand-typed slot id can fail to parse; it must not collide with other
    // workshops that also have no usable slot.
    expect(readSlotStatus({ '': 'W1' }, '', 'W2')).toBe('none');
  });
});
