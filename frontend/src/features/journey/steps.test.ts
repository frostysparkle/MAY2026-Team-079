import { describe, expect, it } from 'vitest';
import { resolveJourney, type JourneyInputs } from './resolve';
import { STEP_META, stepProgress, stepRoute } from './steps';
import { ROUTES } from '@/config/routes';

const complete: JourneyInputs = {
  profileComplete: true,
  accommodationChoice: 'no',
  messChoice: 'no',
  messPlanId: null,
  hasAllocation: false,
  hostelPaid: false,
  messPaid: false,
  eventsRegistered: 3,
};

describe('stepRoute', () => {
  it('sends a finished journey to the student home', () => {
    expect(stepRoute('done')).toBe(ROUTES.home);
  });

  it('sends every pipeline step to the onboarding screen', () => {
    for (const step of ['profile', 'accommodation', 'mess', 'payment', 'events'] as const) {
      expect(stepRoute(step)).toBe(ROUTES.onboarding);
    }
  });
});

describe('stepProgress', () => {
  it('reports the 1-based position of the current step', () => {
    const j = resolveJourney({ ...complete, eventsRegistered: 0, accommodationChoice: null });
    // profileComplete but no accommodation choice → step 2 of 5.
    expect(stepProgress(j)).toEqual({ current: 2, total: STEP_META.length });
  });

  it('caps at the total once the journey is done', () => {
    const j = resolveJourney(complete);
    expect(stepProgress(j)).toEqual({ current: STEP_META.length, total: STEP_META.length });
  });
});
