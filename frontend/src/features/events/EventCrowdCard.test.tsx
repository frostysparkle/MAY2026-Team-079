import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { EventCapacityCountsResponse } from '@/api/types';
import { EventCrowdCard } from './EventCrowdCard';

/**
 * Story 3.3 is only delivered if a participant can *read* how busy an event is
 * before walking over, so these assert the rendered card. The arithmetic behind
 * it is covered by `eventCapacity.test.ts`.
 */
function counts(registered: number, attendedToday: number): EventCapacityCountsResponse {
  return { event_id: 'hack-2026', registered, attended_today: attendedToday };
}

describe('EventCrowdCard (story 3.3)', () => {
  it('says how many are in the venue and how many places are left', () => {
    render(<EventCrowdCard counts={counts(180, 142)} capacity={200} />);
    expect(screen.getByText('142')).toBeInTheDocument();
    expect(screen.getByText(/58 of 200 entries left/)).toBeInTheDocument();
  });

  it('shows a fullness status a participant can act on', () => {
    render(<EventCrowdCard counts={counts(190, 180)} capacity={200} />);
    // 90% of the venue is in — the shared occupancy vocabulary calls that Filling.
    expect(screen.getByText('Filling')).toBeInTheDocument();
  });

  it('reads a packed venue as Full', () => {
    render(<EventCrowdCard counts={counts(200, 200)} capacity={200} />);
    expect(screen.getByText('Full')).toBeInTheDocument();
  });

  it('keeps the raw counts and drops the verdict when no capacity is published', () => {
    render(<EventCrowdCard counts={counts(218, 96)} capacity={undefined} />);
    expect(screen.getByText('96')).toBeInTheDocument();
    expect(screen.getByText('218')).toBeInTheDocument();
    // No capacity to divide by, so no status word is invented.
    for (const word of ['Empty', 'Available', 'Filling', 'Full']) {
      expect(screen.queryByText(word)).not.toBeInTheDocument();
    }
  });

  it('separates "the venue is busy" from "the sign-ups are full"', () => {
    // Registrations have hit the limit while the venue is still nearly empty —
    // the two answer different questions and must not be conflated.
    render(<EventCrowdCard counts={counts(200, 10)} capacity={200} />);
    expect(
      screen.getByText(/registrations have reached the published capacity/),
    ).toBeInTheDocument();
    expect(screen.getByText(/190 of 200 entries left/)).toBeInTheDocument();
  });

  it('is labelled for assistive tech as a single region', () => {
    render(<EventCrowdCard counts={counts(180, 142)} capacity={200} />);
    expect(screen.getByRole('region', { name: 'How busy this event is' })).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Entries used today' })).toHaveAttribute(
      'aria-valuetext',
      '142 of 200',
    );
  });
});
