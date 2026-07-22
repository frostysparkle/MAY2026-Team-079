import type { Journey, JourneyStepState, NextStep, OnboardingChoice } from '@/api/types';

/**
 * Pure onboarding-journey resolver — a faithful mirror of the backend
 * `resolve_journey` (spec: student-experience-redesign, Property 1). Used by the
 * mock API so the offline app behaves like the real backend, and unit-tested to
 * guarantee both sides agree.
 */
export interface JourneyInputs {
  profileComplete: boolean;
  accommodationChoice: OnboardingChoice | null;
  messChoice: OnboardingChoice | null;
  messPlanId: string | null;
  hasAllocation: boolean;
  hostelPaid: boolean;
  messPaid: boolean;
  eventsRegistered: number;
}

const ORDER: NextStep[] = ['profile', 'accommodation', 'mess', 'payment', 'events'];
const INDEX: Record<NextStep, number> = {
  profile: 0,
  accommodation: 1,
  mess: 2,
  payment: 3,
  events: 4,
  done: 5,
};

function nextStep(inp: JourneyInputs, paymentDue: boolean): NextStep {
  if (!inp.profileComplete) return 'profile';
  if (inp.accommodationChoice === null) return 'accommodation';
  if (inp.messChoice === null) return 'mess';
  if (paymentDue) return 'payment';
  if (inp.eventsRegistered === 0) return 'events';
  return 'done';
}

function stepState(index: number, current: number, skipped: boolean): JourneyStepState {
  if (index === current) return 'current';
  if (index > current) return 'upcoming';
  return skipped ? 'skipped' : 'done';
}

export function resolveJourney(inp: JourneyInputs): Journey {
  const accDue = inp.accommodationChoice === 'yes' && !inp.hostelPaid;
  const messDue = inp.messChoice === 'yes' && !inp.messPaid;
  const paymentDue = accDue || messDue;

  const next = nextStep(inp, paymentDue);
  const n = INDEX[next];
  const nothingToPay = !(inp.accommodationChoice === 'yes' || inp.messChoice === 'yes');

  const steps: Journey['steps'] = [
    { key: 'profile', state: stepState(0, n, false) },
    { key: 'accommodation', state: stepState(1, n, inp.accommodationChoice === 'no') },
    { key: 'mess', state: stepState(2, n, inp.messChoice === 'no') },
    { key: 'payment', state: stepState(3, n, nothingToPay) },
    {
      key: 'events',
      state: inp.eventsRegistered > 0 ? 'done' : stepState(4, n, false),
    },
  ];

  return {
    profileComplete: inp.profileComplete,
    accommodation: {
      choice: inp.accommodationChoice,
      allocated: inp.hasAllocation,
      paid: inp.hostelPaid,
    },
    mess: { choice: inp.messChoice, planId: inp.messPlanId, paid: inp.messPaid },
    paymentDue,
    eventsRegistered: inp.eventsRegistered,
    steps,
    nextStep: next,
    complete: next === 'events' || next === 'done',
  };
}

export { ORDER as JOURNEY_ORDER };
