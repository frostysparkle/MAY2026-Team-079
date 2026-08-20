import { describe, it, expect } from 'vitest';
import type { EventCapacityCountsResponse } from '@/api/types';
import { readEventCapacity, readEventCrowd } from './eventCapacity';

function counts(registered: number, attendedToday: number): EventCapacityCountsResponse {
  return { event_id: 'E1', registered, attended_today: attendedToday };
}

describe('readEventCapacity', () => {
  it('reports the entries left against a published capacity', () => {
    const readout = readEventCapacity(200, 142);
    expect(readout).not.toBeNull();
    expect(readout?.capacity).toBe(200);
    expect(readout?.admitted).toBe(142);
    expect(readout?.remaining).toBe(58);
    expect(readout?.percent).toBe(71);
    expect(readout?.status).toBe('available');
    expect(readout?.atCapacity).toBe(false);
    expect(readout?.over).toBe(0);
    expect(readout?.summary).toBe('58 of 200 entries left');
  });

  it('returns null when the organiser has published no capacity', () => {
    // Unset, zero and negative all mean "no limit declared" — see
    // `eventExtras.parseCapacity`. None of them may render as a closed gate.
    expect(readEventCapacity(undefined, 10)).toBeNull();
    expect(readEventCapacity(null, 10)).toBeNull();
    expect(readEventCapacity(0, 10)).toBeNull();
    expect(readEventCapacity(-5, 10)).toBeNull();
  });

  it('crosses into filling at 75% and full at the limit', () => {
    expect(readEventCapacity(100, 74)?.status).toBe('available');
    expect(readEventCapacity(100, 75)?.status).toBe('filling');
    expect(readEventCapacity(100, 99)?.label).toBe('Filling');
    expect(readEventCapacity(100, 100)?.status).toBe('full');
    expect(readEventCapacity(100, 100)?.tone).toBe('danger');
  });

  it('reads nobody through the gate yet as empty, not as unreadable', () => {
    const readout = readEventCapacity(50, 0);
    expect(readout?.status).toBe('empty');
    expect(readout?.remaining).toBe(50);
    expect(readout?.summary).toBe('50 of 50 entries left');
  });

  it('reports an over-admitted gate as zero left plus the overshoot', () => {
    const readout = readEventCapacity(200, 212);
    // Never negative: an over-admitted gate has no entries left, not "-12" of them.
    expect(readout?.remaining).toBe(0);
    expect(readout?.over).toBe(12);
    expect(readout?.atCapacity).toBe(true);
    expect(readout?.percent).toBe(106);
    expect(readout?.summary).toBe('12 over a capacity of 200');
  });

  it('says "capacity reached" at exactly the limit rather than "0 left"', () => {
    expect(readEventCapacity(200, 200)?.summary).toBe('Capacity reached — 0 of 200 entries left');
  });

  it('keeps an unreadable admitted figure null instead of flattening it to zero', () => {
    // A UHC caller gets a participation response with no `total_daily_scans`.
    const readout = readEventCapacity(200, null);
    expect(readout?.admitted).toBeNull();
    expect(readout?.remaining).toBeNull();
    expect(readout?.status).toBeNull();
    expect(readout?.label).toBe('');
    expect(readout?.tone).toBe('neutral');
    expect(readout?.atCapacity).toBe(false);
    expect(readout?.summary).toBe('Capacity 200');
  });

  it('formats four-figure capacities with thousands separators', () => {
    expect(readEventCapacity(1200, 200)?.summary).toBe('1,000 of 1,200 entries left');
  });
});

describe('readEventCrowd', () => {
  it('reads the venue against attendance and demand against registrations', () => {
    // Two questions off one capacity: "is it busy in there right now" and "will
    // there be room for me at all". A participant acts on them differently.
    const crowd = readEventCrowd(counts(180, 142), 200);
    expect(crowd.attendedToday).toBe(142);
    expect(crowd.registered).toBe(180);
    expect(crowd.venue?.remaining).toBe(58);
    expect(crowd.demand?.remaining).toBe(20);
  });

  it('keeps the raw counts when the organiser published no capacity', () => {
    // Still worth showing: "218 registered, 96 in today" is useful on its own,
    // and a fullness verdict with nothing to divide by is not.
    const crowd = readEventCrowd(counts(218, 96), undefined);
    expect(crowd.registered).toBe(218);
    expect(crowd.attendedToday).toBe(96);
    expect(crowd.venue).toBeNull();
    expect(crowd.demand).toBeNull();
  });

  it('flags an event whose registrations have reached the limit', () => {
    const crowd = readEventCrowd(counts(200, 10), 200);
    expect(crowd.demand?.atCapacity).toBe(true);
    // The venue itself is nearly empty — the two must not be conflated.
    expect(crowd.venue?.atCapacity).toBe(false);
    expect(crowd.venue?.status).toBe('available');
    expect(crowd.venue?.remaining).toBe(190);
  });
});
