import { describe, it, expect } from 'vitest';
import type { Workshop } from '@/api/types';
import { formatSlotId, parseSlotId, workshopDayLabel } from './workshopSlot';
import {
  publicWorkshopView,
  sortWorkshops,
  workshopDays,
  workshopPosterPaths,
  workshopView,
  WORKSHOP_COVER,
} from './workshopView';

function makeWorkshop(overrides: Partial<Workshop> = {}): Workshop {
  return {
    workshop_id: 'workshop-12',
    slot_id: '2026-06-11-morning',
    name: 'Embedded Rust',
    venue: 'CRC 102',
    capacity: 20,
    instructions: 'Bring a laptop.',
    registration_count: 5,
    participant_count: 0,
    workshop_team: [],
    ...overrides,
  };
}

describe('workshopSlot', () => {
  it('round-trips a day and shift through slot_id', () => {
    const slot = formatSlotId('2026-06-11', 'morning');
    expect(slot).toBe('2026-06-11-morning');
    expect(parseSlotId(slot)).toEqual({ date: '2026-06-11', shift: 'morning' });
  });

  it('leaves a free-form slot id alone instead of rejecting it', () => {
    // An admin may have typed one by hand; the workshop still belongs on the
    // programme, it just carries no day/shift filter.
    expect(parseSlotId('SLOT_A')).toEqual({});
    expect(parseSlotId(undefined)).toEqual({});
    expect(parseSlotId('2026-06-11-evening')).toEqual({});
  });

  it('formats a day without a timezone shift', () => {
    // Parsing "2026-06-01" as a Date would land on 31 May in negative offsets.
    expect(workshopDayLabel('2026-06-01')).toBe('1 June');
    expect(workshopDayLabel('2026-06-11')).toBe('11 June');
  });

  it('returns a non-date label unchanged', () => {
    expect(workshopDayLabel('SLOT_A')).toBe('SLOT_A');
  });
});

describe('workshopPosterPaths', () => {
  it('derives both flyer sizes from the workshop id', () => {
    expect(workshopPosterPaths('workshop-12')).toEqual({
      poster: '/images/workshops/workshop-12.avif',
      posterFull: '/images/workshops/workshop-12-full.avif',
    });
  });
});

describe('workshopView', () => {
  it('normalises a workshop and computes the seats left', () => {
    const view = workshopView(makeWorkshop());
    expect(view.id).toBe('workshop-12');
    expect(view.dayLabel).toBe('11 June');
    expect(view.slot).toEqual({ date: '2026-06-11', shift: 'morning' });
    expect(view.seatsLeft).toBe(15);
    expect(view.poster).toBe('/images/workshops/workshop-12.avif');
    // The authenticated view keeps the record so it can be acted on.
    expect(view.workshop).toBeDefined();
  });

  it('never reports negative seats when a workshop is over capacity', () => {
    const view = workshopView(makeWorkshop({ capacity: 5, registration_count: 9 }));
    expect(view.seatsLeft).toBe(0);
  });

  it('carries no live record on the public view', () => {
    const { workshop_team, participant_count, ...record } = makeWorkshop();
    void workshop_team;
    void participant_count;
    const view = publicWorkshopView(record);
    expect(view.workshop).toBeUndefined();
    expect(view.name).toBe('Embedded Rust');
  });

  it('exposes a fallback cover for workshops with no flyer on disk', () => {
    expect(WORKSHOP_COVER).toMatch(/\.avif$/);
  });
});

describe('sortWorkshops', () => {
  it('orders by day, then morning before afternoon, then id', () => {
    const views = [
      workshopView(makeWorkshop({ workshop_id: 'c', slot_id: '2026-06-12-morning' })),
      workshopView(makeWorkshop({ workshop_id: 'a', slot_id: '2026-06-11-afternoon' })),
      workshopView(makeWorkshop({ workshop_id: 'b', slot_id: '2026-06-11-morning' })),
    ];
    expect(sortWorkshops(views).map((v) => v.id)).toEqual(['b', 'a', 'c']);
  });

  it('sorts undated workshops last rather than first', () => {
    const views = [
      workshopView(makeWorkshop({ workshop_id: 'undated', slot_id: 'SLOT_A' })),
      workshopView(makeWorkshop({ workshop_id: 'dated', slot_id: '2026-06-11-morning' })),
    ];
    expect(sortWorkshops(views).map((v) => v.id)).toEqual(['dated', 'undated']);
  });
});

describe('workshopDays', () => {
  it('derives the days from the programme, with counts', () => {
    const views = [
      workshopView(makeWorkshop({ workshop_id: 'a', slot_id: '2026-06-11-morning' })),
      workshopView(makeWorkshop({ workshop_id: 'b', slot_id: '2026-06-11-afternoon' })),
      workshopView(makeWorkshop({ workshop_id: 'c', slot_id: '2026-06-12-morning' })),
      workshopView(makeWorkshop({ workshop_id: 'd', slot_id: 'SLOT_A' })),
    ];
    expect(workshopDays(views)).toEqual([
      { date: '2026-06-11', label: '11 June', count: 2 },
      { date: '2026-06-12', label: '12 June', count: 1 },
    ]);
  });
});
