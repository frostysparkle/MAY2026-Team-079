/**
 * Guards the migrated Paradox catalogue.
 *
 * Every event now lives in the database, created through the Super Admin
 * dashboard, and the dataset in `src/data/paradoxEvents.json` is what was
 * created. These cases pin the details that the plain `Event` columns cannot
 * express, so a future change to the view layer cannot quietly reword the
 * published programme.
 */
import { describe, it, expect } from 'vitest';
import type { PublicEventRecord } from '@/api/types';
import { categorySlugForEventType, publicEventView } from './eventView';
import { getPublicEventCategory } from './publicEvents';
import seed from '@/data/paradoxEvents.json';

const RECORDS = (seed as unknown as PublicEventRecord[]).map((e) => ({ ...e, open: true }));
const byId = new Map(RECORDS.map((e) => [e.event_id, e]));

function viewOf(eventId: string) {
  const record = byId.get(eventId);
  expect(record, `no event ${eventId} in the dataset`).toBeDefined();
  const view = publicEventView(record!);
  expect(view, `event ${eventId} has no public category`).not.toBeNull();
  return view!;
}

describe('published catalogue dataset', () => {
  it('holds the whole festival programme under public categories', () => {
    expect(RECORDS).toHaveLength(53);
    expect(new Set(RECORDS.map((e) => e.event_id)).size).toBe(53);
    for (const record of RECORDS) {
      expect(categorySlugForEventType(record.event_type), record.event_id).not.toBeNull();
      expect(publicEventView(record), record.event_id).not.toBeNull();
    }
  });

  it('keeps an advertised round count that differs from the rounds listed', () => {
    // Paradox Premier League advertises 8 rounds while listing 4 fixtures, so
    // the count cannot be `schedule.length`.
    const view = viewOf('84');
    expect(view.timeline).toHaveLength(4);
    expect(view.meta).toContainEqual({ label: 'Rounds', value: '8' });
  });

  it('keeps a zero round count even though rounds are listed', () => {
    const view = viewOf('102');
    expect(view.timeline).toHaveLength(2);
    expect(view.meta).toContainEqual({ label: 'Rounds', value: '0' });
  });

  it('shows only the tiles an event actually advertises', () => {
    // This one publishes dates and nothing else — no team size, no round count,
    // no registration window — so no tile may be invented for it.
    const view = viewOf('deeptech-venture-building');
    expect(view.meta).toEqual([
      { label: 'Start Date', value: '11 June' },
      { label: 'End Date', value: '11 June' },
    ]);
  });

  it('prints prizes that are not sums of money', () => {
    expect(viewOf('56').prizes).toContainEqual({
      label: 'Special Mention (Video)',
      amount: '1 Plaque',
    });
    expect(viewOf('52').prizes).toContainEqual({
      label: 'Street & Stage Play Actors',
      amount: '25 Plaques',
    });
    expect(viewOf('122').prizes).toContainEqual({
      label: 'Top 5 Teams',
      amount: '₹10000 each',
    });
  });

  it('prints round times as written, with their venue', () => {
    const [first] = viewOf('22').timeline;
    expect(first.name).toBe('Online Preliminary Round');
    // Not a formatted date: `new Date('2 Jun')` would silently land in 2001.
    expect(first.when).toBe('2 Jun, 04:00 pm · Online');
    expect(first.venue).toBe('Online');
  });

  it('falls back to the category artwork for an event with no poster', () => {
    const view = viewOf('64');
    expect(view.poster).toBe(getPublicEventCategory('culturals')!.image);
  });

  it('reads registration extras back off the stored event', () => {
    const view = viewOf('22');
    expect(view.rulebook).toContain('docs.google.com');
    expect(view.faqs.length).toBeGreaterThan(0);
    expect(view.description).toContain('Last1Standing');
    // The brochure projection carries no live record to register against.
    expect(view.source).toBe('public');
    expect(view.event).toBeUndefined();
  });
});
