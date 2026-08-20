import { describe, it, expect } from 'vitest';
import type { Event, PublicEventRecord } from '@/api/types';
import {
  backendEventView,
  categorySlugForEventType,
  publicEventsForCategory,
  publicEventView,
} from './eventView';
import { getPublicEventCategory } from './publicEvents';
import { writeEventRegistration } from './eventExtras';

function makeEvent(overrides: Partial<Event> = {}): Event {
  return {
    event_id: 'hack-2026',
    event_type: 'technical',
    name: 'Hackathon 2026',
    description: 'Build something in 24 hours.',
    poster: '',
    open: true,
    team: { min: 2, max: 4, house: false, allow_single_registration: true },
    prize_money: [{ position: 'Winner', amount: 40000 }],
    registration: writeEventRegistration({
      startTime: '2026-06-01T09:00',
      endTime: '2026-06-05T23:59',
      rulebook: 'https://example.com/rules',
      faqs: [{ q: 'Laptops?', a: 'Bring your own.' }],
    }),
    schedule: [
      {
        name: 'Round 1',
        description: 'Idea pitch',
        start_time: '2026-06-10T10:00',
        end_time: '2026-06-10T12:00',
      },
    ],
    registration_fields: [],
    event_team: [],
    ...overrides,
  };
}

/** The same event as the public brochure returns it: published fields only. */
function makePublicRecord(overrides: Partial<Event> = {}): PublicEventRecord {
  const {
    event_id,
    event_type,
    name,
    description,
    poster,
    team,
    open,
    prize_money,
    registration,
    schedule,
  } = makeEvent(overrides);
  return {
    event_id,
    event_type,
    name,
    description,
    poster,
    team,
    open,
    prize_money,
    registration,
    schedule,
  };
}

describe('categorySlugForEventType', () => {
  it('maps the backend vocabulary onto catalogue slugs', () => {
    // The backend says "technical"; the catalogue slug is "technicals".
    expect(categorySlugForEventType('technical')).toBe('technicals');
    expect(categorySlugForEventType('culturals')).toBe('culturals');
    expect(categorySlugForEventType('sports')).toBe('sports');
  });

  it('has no public home for "others" or an unknown type', () => {
    expect(categorySlugForEventType('others')).toBeNull();
    expect(categorySlugForEventType('quidditch')).toBeNull();
  });
});

describe('backendEventView', () => {
  it('normalises a backend event into the view shape', () => {
    const view = backendEventView(makeEvent());
    expect(view).not.toBeNull();
    expect(view!.name).toBe('Hackathon 2026');
    expect(view!.source).toBe('backend');
    expect(view!.event).toBeDefined();
    expect(view!.category.slug).toBe('technicals');
    expect(view!.rulebook).toBe('https://example.com/rules');
    expect(view!.faqs).toEqual([{ q: 'Laptops?', a: 'Bring your own.' }]);
    expect(view!.prizes).toEqual([{ label: 'Winner', amount: '₹40,000' }]);
    expect(view!.timeline[0].name).toBe('Round 1');
    expect(view!.meta).toContainEqual({ label: 'Team Size', value: '2 – 4' });
  });

  it('falls back to the category artwork when no poster is set', () => {
    const view = backendEventView(makeEvent({ poster: '   ' }));
    expect(view!.poster).toBe(getPublicEventCategory('technicals')!.image);
  });

  it('returns null for an event with no public category', () => {
    expect(backendEventView(makeEvent({ event_type: 'others' }))).toBeNull();
  });

  it('collapses an equal team min and max to a single number', () => {
    const view = backendEventView(
      makeEvent({ team: { min: 1, max: 1, house: false, allow_single_registration: true } }),
    );
    expect(view!.meta).toContainEqual({ label: 'Team Size', value: '1' });
  });

  it('derives the meta tiles from the columns when nothing is curated', () => {
    const view = backendEventView(makeEvent());
    expect(view!.meta).toEqual([
      { label: 'Team Size', value: '2 – 4' },
      { label: 'Rounds', value: '1' },
      { label: 'Start Date', value: '10 June' },
      { label: 'End Date', value: '10 June' },
      { label: 'Reg. Start', value: '1 June' },
      { label: 'Reg. End', value: '5 June' },
    ]);
  });
});

describe('display overlay', () => {
  it('lets curated tiles replace the derived ones entirely', () => {
    const view = backendEventView(
      makeEvent({
        registration: writeEventRegistration({
          meta: [
            { label: 'Rounds', value: '8' },
            { label: 'Start Date', value: '10 June' },
          ],
        }),
      }),
    );
    // No Team Size tile, even though the event has a team rule.
    expect(view!.meta).toEqual([
      { label: 'Rounds', value: '8' },
      { label: 'Start Date', value: '10 June' },
    ]);
  });

  it('prints a prize amount that is not a sum of money', () => {
    const view = backendEventView(
      makeEvent({
        prize_money: [
          { position: 'Winner', amount: 3000 },
          { position: 'Special Mention', amount: 1 },
        ],
        registration: writeEventRegistration({ prizeAmounts: ['', '1 Plaque'] }),
      }),
    );
    // A blank entry keeps its slot, so the override lands on the second prize.
    expect(view!.prizes).toEqual([
      { label: 'Winner', amount: '₹3,000' },
      { label: 'Special Mention', amount: '1 Plaque' },
    ]);
  });

  it('prints a round time as written, with its venue', () => {
    const view = backendEventView(
      makeEvent({
        schedule: [
          {
            name: 'Task Rush',
            start_time: '2026-06-10T15:30',
            end_time: '',
            venue: 'KV Ground',
          },
        ],
        registration: writeEventRegistration({ roundWhen: ['10 Jun, 03:30 pm'] }),
      }),
    );
    expect(view!.timeline).toEqual([
      { name: 'Task Rush', when: '10 Jun, 03:30 pm', venue: 'KV Ground', description: undefined },
    ]);
  });
});

describe('non-timestamp round times', () => {
  it('passes a written date through instead of parsing it', () => {
    // `new Date('1 Jun')` succeeds and lands in 2001, so a parse-failure
    // fallback would silently rewrite this to "1 Jun, 12:00 am".
    const view = backendEventView(
      makeEvent({
        schedule: [{ name: 'Finals', start_time: '1 Jun', end_time: '' }],
      }),
    );
    expect(view!.timeline[0].when).toBe('1 Jun');
    expect(view!.meta).toContainEqual({ label: 'Start Date', value: '1 Jun' });
  });
});

describe('publicEventView', () => {
  it('carries no live record to register against', () => {
    const view = publicEventView(makePublicRecord());
    expect(view!.source).toBe('public');
    expect(view!.event).toBeUndefined();
    expect(view!.name).toBe('Hackathon 2026');
  });
});

describe('publicEventsForCategory', () => {
  it('keeps events of that category, including ones closed for registration', () => {
    const records = [
      makePublicRecord({ event_id: 'a', event_type: 'technical' }),
      makePublicRecord({ event_id: 'b', event_type: 'sports' }),
      // `open` is the registration state, not a publication flag: a closed event
      // still belongs on the public programme.
      makePublicRecord({ event_id: 'c', event_type: 'technical', open: false }),
      makePublicRecord({ event_id: 'd', event_type: 'others' }),
    ];
    expect(publicEventsForCategory(records, 'technicals').map((v) => v.id)).toEqual(['a', 'c']);
    expect(publicEventsForCategory(records, 'sports').map((v) => v.id)).toEqual(['b']);
  });
});

describe('capacity and entry requirements on the view', () => {
  const registration = writeEventRegistration({
    capacity: 120,
    entry: {
      reportingTime: '30 minutes before your round',
      idProof: 'Institute ID card',
      allowedItems: ['Laptop', 'Charger'],
      rules: ['Entry closes 10 minutes after the round begins.'],
    },
  });

  it('carries both onto a backend event view', () => {
    const view = backendEventView(makeEvent({ registration }));
    expect(view!.capacity).toBe(120);
    expect(view!.entry).toEqual({
      reportingTime: '30 minutes before your round',
      idProof: 'Institute ID card',
      allowedItems: ['Laptop', 'Charger'],
      rules: ['Entry closes 10 minutes after the round begins.'],
    });
  });

  it('reaches the pre-login brochure too, since `registration` is a published field', () => {
    const view = publicEventView(makePublicRecord({ registration }));
    expect(view!.capacity).toBe(120);
    expect(view!.entry.idProof).toBe('Institute ID card');
  });

  it('leaves capacity absent and the entry block empty when nothing is set', () => {
    const view = backendEventView(makeEvent());
    expect(view!.capacity).toBeUndefined();
    expect(view!.entry).toEqual({
      reportingTime: undefined,
      idProof: undefined,
      allowedItems: [],
      rules: [],
    });
  });

  it('does not let capacity displace the derived meta tiles', () => {
    const view = backendEventView(makeEvent({ registration }));
    // Capacity is its own field; the tiles are still derived from the columns.
    expect(view!.meta).toContainEqual({ label: 'Team Size', value: '2 – 4' });
  });
});
