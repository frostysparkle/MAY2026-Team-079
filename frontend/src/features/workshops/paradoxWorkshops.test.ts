import { describe, it, expect } from 'vitest';
import type { WorkshopCreateRequest } from '@/api/types';
import paradoxWorkshops from '@/data/paradoxWorkshops.json';
import { parseSlotId, WORKSHOP_SHIFTS } from './workshopSlot';
import { workshopPosterPaths } from './workshopView';

/**
 * The migrated Paradox workshop programme. Its content comes from the flyers in
 * `public/images/workshops/` and the venues from the Paradox check-in emails, so
 * these assertions pin the shape of that migration — not the styling of any page.
 */
const WORKSHOPS = paradoxWorkshops as WorkshopCreateRequest[];

describe('paradoxWorkshops dataset', () => {
  it('carries the whole programme', () => {
    expect(WORKSHOPS).toHaveLength(57);
  });

  it('gives every workshop the fields the backend requires', () => {
    for (const w of WORKSHOPS) {
      expect(w.workshop_id, w.workshop_id).toMatch(/^workshop-\d{2}$/);
      expect(w.name.trim(), w.workshop_id).not.toBe('');
      expect(w.venue.trim(), w.workshop_id).not.toBe('');
      expect(w.instructions.trim(), w.workshop_id).not.toBe('');
    }
  });

  it('sets every capacity to 100', () => {
    expect(new Set(WORKSHOPS.map((w) => w.capacity))).toEqual(new Set([100]));
  });

  it('uses ids that resolve to a real flyer', () => {
    // The poster is derived from the id rather than stored, so a mismatch here
    // would silently fall back to the generic cover across the whole catalogue.
    for (const w of WORKSHOPS) {
      expect(workshopPosterPaths(w.workshop_id).poster).toBe(
        `/images/workshops/${w.workshop_id}.avif`,
      );
    }
  });

  it('encodes a parseable day and shift in every slot_id', () => {
    for (const w of WORKSHOPS) {
      const slot = parseSlotId(w.slot_id);
      expect(slot.date, `${w.workshop_id} ${w.slot_id}`).toMatch(/^2026-06-\d{2}$/);
      expect(WORKSHOP_SHIFTS).toContain(slot.shift!);
    }
  });

  it('spreads across the four festival days', () => {
    const byDay = new Map<string, number>();
    for (const w of WORKSHOPS) {
      const d = parseSlotId(w.slot_id).date!;
      byDay.set(d, (byDay.get(d) ?? 0) + 1);
    }
    // Matches the day counts of the catalogue this replaced.
    expect(Object.fromEntries([...byDay].sort())).toEqual({
      '2026-06-10': 5,
      '2026-06-11': 19,
      '2026-06-12': 17,
      '2026-06-13': 16,
    });
  });

  it('has no duplicate ids', () => {
    expect(new Set(WORKSHOPS.map((w) => w.workshop_id)).size).toBe(WORKSHOPS.length);
  });

  it('keeps the two workshops whose venue no email covered clearly marked', () => {
    const tba = WORKSHOPS.filter((w) => w.venue === 'To be announced');
    expect(tba.map((w) => w.workshop_id)).toEqual(['workshop-15', 'workshop-56']);
  });

  it('carries the flyer copy verbatim, speaker included', () => {
    const ethics = WORKSHOPS.find((w) => w.workshop_id === 'workshop-02')!;
    expect(ethics.name).toBe('Ethics of AI');
    expect(ethics.venue).toBe('CRC - 101');
    expect(ethics.slot_id).toBe('2026-06-12-afternoon');
    expect(ethics.instructions).toContain('Speaker: Prof. Partha Pratim Das');
    expect(ethics.instructions).toContain('Pre-requisites:');
  });
});
