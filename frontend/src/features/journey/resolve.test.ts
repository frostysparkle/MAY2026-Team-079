import { describe, expect, it } from 'vitest';
import { resolveJourney, type JourneyInputs } from './resolve';

/**
 * The pure resolver must agree with the backend `resolve_journey` across the
 * onboarding state matrix (spec: student-experience-redesign, Property 1-3).
 * These cases mirror the backend unit tests so both sides stay in lock-step.
 */
const base: JourneyInputs = {
  profileComplete: false,
  accommodationChoice: null,
  messChoice: null,
  messPlanId: null,
  hasAllocation: false,
  hostelPaid: false,
  messPaid: false,
  eventsRegistered: 0,
};

describe('resolveJourney', () => {
  it('sends a brand-new user to the profile step', () => {
    const j = resolveJourney(base);
    expect(j.nextStep).toBe('profile');
    expect(j.complete).toBe(false);
    expect(j.steps[0]).toEqual({ key: 'profile', state: 'current' });
  });

  it('asks for the accommodation choice once the profile is complete', () => {
    const j = resolveJourney({ ...base, profileComplete: true });
    expect(j.nextStep).toBe('accommodation');
    expect(j.steps[0].state).toBe('done');
    expect(j.steps[1].state).toBe('current');
  });

  it('asks for the mess choice after an accommodation choice', () => {
    const j = resolveJourney({
      ...base,
      profileComplete: true,
      accommodationChoice: 'no',
    });
    expect(j.nextStep).toBe('mess');
    expect(j.steps[1].state).toBe('skipped');
  });

  it('requires payment when accommodation is chosen but unpaid', () => {
    const j = resolveJourney({
      ...base,
      profileComplete: true,
      accommodationChoice: 'yes',
      messChoice: 'no',
      hostelPaid: false,
    });
    expect(j.paymentDue).toBe(true);
    expect(j.nextStep).toBe('payment');
  });

  it('requires payment when a mess plan is chosen but unpaid', () => {
    const j = resolveJourney({
      ...base,
      profileComplete: true,
      accommodationChoice: 'no',
      messChoice: 'yes',
      messPlanId: 'plan_full',
      messPaid: false,
    });
    expect(j.paymentDue).toBe(true);
    expect(j.nextStep).toBe('payment');
  });

  it('skips payment when both optional bookings are declined', () => {
    const j = resolveJourney({
      ...base,
      profileComplete: true,
      accommodationChoice: 'no',
      messChoice: 'no',
    });
    expect(j.paymentDue).toBe(false);
    expect(j.nextStep).toBe('events');
    expect(j.steps[3].state).toBe('skipped');
    expect(j.complete).toBe(true);
  });

  it('prompts for events once everything chosen is paid', () => {
    const j = resolveJourney({
      ...base,
      profileComplete: true,
      accommodationChoice: 'yes',
      messChoice: 'yes',
      messPlanId: 'plan_full',
      hasAllocation: true,
      hostelPaid: true,
      messPaid: true,
      eventsRegistered: 0,
    });
    expect(j.paymentDue).toBe(false);
    expect(j.nextStep).toBe('events');
    expect(j.complete).toBe(true);
  });

  it('is done once the user has at least one registration', () => {
    const j = resolveJourney({
      ...base,
      profileComplete: true,
      accommodationChoice: 'no',
      messChoice: 'no',
      eventsRegistered: 2,
    });
    expect(j.nextStep).toBe('done');
    expect(j.complete).toBe(true);
    expect(j.steps[4].state).toBe('done');
  });

  it('is a pure function — identical inputs yield identical output', () => {
    const inp: JourneyInputs = { ...base, profileComplete: true, accommodationChoice: 'yes' };
    expect(resolveJourney(inp)).toEqual(resolveJourney(inp));
  });
});
