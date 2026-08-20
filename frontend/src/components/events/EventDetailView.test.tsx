import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { Event } from '@/api/types';
import { EventDetailView } from './EventDetailView';
import { fullEventView } from '@/features/events/eventView';
import { writeEventRegistration } from '@/features/events/eventExtras';

/**
 * Stories 1.3 and 1.4 are only delivered if a participant can *see* the capacity
 * and the entry requirements an admin published, so these assert the rendered
 * page rather than the view model — which `eventView.test.ts` already covers.
 */
function makeEvent(registration: Event['registration']): Event {
  return {
    event_id: 'hack-2026',
    event_type: 'technical',
    name: 'Hackathon 2026',
    description: 'Build something in 24 hours.',
    poster: '',
    open: true,
    team: { min: 2, max: 4, house: false, allow_single_registration: true },
    prize_money: [],
    registration,
    schedule: [],
    registration_fields: [],
    event_team: [],
  };
}

function renderEvent(registration: Event['registration']) {
  render(<EventDetailView view={fullEventView(makeEvent(registration))} />);
}

describe('EventDetailView — capacity (story 1.3)', () => {
  it('shows a published capacity as a tile', () => {
    renderEvent(writeEventRegistration({ capacity: 120 }));
    expect(screen.getByText('Capacity')).toBeInTheDocument();
    expect(screen.getByText('120')).toBeInTheDocument();
  });

  it('shows no capacity tile when the organiser never set one', () => {
    renderEvent(writeEventRegistration({ startTime: '2026-06-01T09:00' }));
    expect(screen.queryByText('Capacity')).not.toBeInTheDocument();
  });

  it('does not print a second Capacity tile when the curated list has one', () => {
    renderEvent(
      writeEventRegistration({
        capacity: 120,
        meta: [{ label: 'Capacity', value: '120 teams' }],
      }),
    );
    expect(screen.getAllByText('Capacity')).toHaveLength(1);
    expect(screen.getByText('120 teams')).toBeInTheDocument();
  });
});

describe('EventDetailView — entry requirements (story 1.4)', () => {
  const full = writeEventRegistration({
    entry: {
      reportingTime: '30 minutes before your round',
      idProof: 'Institute ID card',
      allowedItems: ['Laptop', 'Charger'],
      rules: ['Entry closes 10 minutes after the round begins.', 'No re-entry once you leave.'],
    },
  });

  it('renders all four requirements under one heading', () => {
    renderEvent(full);

    expect(screen.getByRole('heading', { name: 'Before You Go' })).toBeInTheDocument();
    expect(screen.getByText('30 minutes before your round')).toBeInTheDocument();
    expect(screen.getByText('Institute ID card')).toBeInTheDocument();
    expect(screen.getByText('Laptop')).toBeInTheDocument();
    expect(screen.getByText('Charger')).toBeInTheDocument();
    expect(screen.getByText('Entry closes 10 minutes after the round begins.')).toBeInTheDocument();
    expect(screen.getByText('No re-entry once you leave.')).toBeInTheDocument();
  });

  it('hides the whole section when no requirement is set', () => {
    renderEvent(writeEventRegistration({ startTime: '2026-06-01T09:00' }));
    expect(screen.queryByRole('heading', { name: 'Before You Go' })).not.toBeInTheDocument();
  });

  it('shows only the parts an organiser has filled in', () => {
    renderEvent(writeEventRegistration({ entry: { idProof: 'Institute ID card' } }));

    expect(screen.getByRole('heading', { name: 'Before You Go' })).toBeInTheDocument();
    expect(screen.getByText('ID proof required')).toBeInTheDocument();
    expect(screen.queryByText('Reporting time')).not.toBeInTheDocument();
    expect(screen.queryByText('Allowed items')).not.toBeInTheDocument();
    expect(screen.queryByText('Entry rules')).not.toBeInTheDocument();
  });

  it('keeps the "coming soon" notice away once entry details exist', () => {
    // An event with no description, rounds, or prizes is otherwise treated as
    // empty — entry requirements alone are enough to make the page worth reading.
    renderEvent(full);
    expect(
      screen.queryByText(/Full details for this event are coming soon/),
    ).not.toBeInTheDocument();
  });
});
