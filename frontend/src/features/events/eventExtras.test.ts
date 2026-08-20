import { describe, it, expect } from 'vitest';
import {
  hasEntryInfo,
  optionsForField,
  readEventExtras,
  readRegistrationWindow,
  writeEventRegistration,
} from './eventExtras';

describe('eventExtras', () => {
  it('round-trips rulebook, FAQs and select choices through the registration map', () => {
    const map = writeEventRegistration({
      startTime: '2026-06-03T09:00',
      endTime: '2026-06-11T23:59',
      rulebook: 'https://docs.google.com/document/d/abc',
      faqs: [{ q: 'Team size?', a: '2 to 4.' }],
      fieldOptions: { tshirt: ['S', 'M', 'L'] },
    });

    expect(readRegistrationWindow(map)).toEqual({
      startTime: '2026-06-03T09:00',
      endTime: '2026-06-11T23:59',
    });

    const extras = readEventExtras(map);
    expect(extras.rulebook).toBe('https://docs.google.com/document/d/abc');
    expect(extras.faqs).toEqual([{ q: 'Team size?', a: '2 to 4.' }]);
    expect(extras.fieldOptions.tshirt).toEqual(['S', 'M', 'L']);
  });

  it('omits empty values rather than writing blank keys', () => {
    const map = writeEventRegistration({
      startTime: '   ',
      rulebook: '',
      faqs: [{ q: '', a: 'orphan answer' }],
      fieldOptions: { empty: ['  ', ''] },
    });
    expect(map).toEqual({});
  });

  it('keeps the backend keys separate from our piggybacked ones', () => {
    const map = writeEventRegistration({
      startTime: '2026-06-03T09:00',
      rulebook: 'https://example.com',
    });
    expect(Object.keys(map).sort()).toEqual(['rulebook', 'start_time']);
    // The rulebook must never be mistaken for part of the window.
    expect(readRegistrationWindow(map).endTime).toBeUndefined();
  });

  it('degrades to absent on malformed data instead of throwing', () => {
    const extras = readEventExtras({
      faqs: 'not json at all',
      'options:x': '{"not":"an array"}',
    } as never);
    expect(extras.faqs).toEqual([]);
    expect(extras.fieldOptions).toEqual({});
    expect(extras.rulebook).toBeUndefined();
  });

  it('drops FAQ entries that are missing a question or answer', () => {
    const extras = readEventExtras({
      faqs: JSON.stringify([{ q: 'Kept?', a: 'Yes' }, { q: 'No answer' }, { a: 'No question' }]),
    } as never);
    expect(extras.faqs).toEqual([{ q: 'Kept?', a: 'Yes' }]);
  });

  it('returns no choices for a field that was never configured', () => {
    const extras = readEventExtras({ 'options:size': JSON.stringify(['S']) } as never);
    const field = { field_id: 'other', label: 'Other', type: 'select', required: true };
    expect(optionsForField(extras, field)).toEqual([]);
    expect(optionsForField(extras, { ...field, field_id: 'size' })).toEqual(['S']);
  });

  it('treats a missing registration map as empty', () => {
    expect(readEventExtras(undefined).faqs).toEqual([]);
    expect(readRegistrationWindow(undefined)).toEqual({
      startTime: undefined,
      endTime: undefined,
    });
  });
});

describe('eventExtras — capacity (story 1.3)', () => {
  it('round-trips a capacity through the registration map', () => {
    const map = writeEventRegistration({ capacity: 120 });
    expect(map.capacity).toBe('120');
    expect(readEventExtras(map).capacity).toBe(120);
  });

  it('does not write a capacity that is not a positive whole number', () => {
    for (const capacity of [0, -5, 12.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(writeEventRegistration({ capacity })).toEqual({});
    }
  });

  it('reads a stored capacity of zero, junk, or a fraction as unset', () => {
    for (const raw of ['0', '-5', '12.5', 'lots', '', '   ']) {
      expect(readEventExtras({ capacity: raw } as never).capacity).toBeUndefined();
    }
  });

  it('leaves capacity out of the registration window', () => {
    const map = writeEventRegistration({ startTime: '2026-06-03T09:00', capacity: 40 });
    expect(readRegistrationWindow(map)).toEqual({
      startTime: '2026-06-03T09:00',
      endTime: undefined,
    });
  });
});

describe('eventExtras — entry requirements (story 1.4)', () => {
  it('round-trips reporting time, ID proof, allowed items and rules', () => {
    const map = writeEventRegistration({
      entry: {
        reportingTime: '30 minutes before your round',
        idProof: 'Institute ID card',
        allowedItems: ['Laptop', 'Charger'],
        rules: ['Entry closes 10 minutes after the round begins.'],
      },
    });

    expect(readEventExtras(map).entry).toEqual({
      reportingTime: '30 minutes before your round',
      idProof: 'Institute ID card',
      allowedItems: ['Laptop', 'Charger'],
      rules: ['Entry closes 10 minutes after the round begins.'],
    });
  });

  it('trims and drops blank items rather than storing them', () => {
    const map = writeEventRegistration({
      entry: {
        reportingTime: '   ',
        allowedItems: ['  Laptop  ', '', '   '],
        rules: [],
      },
    });

    expect(map).toEqual({ allowed_items: JSON.stringify(['Laptop']) });

    const entry = readEventExtras(map).entry;
    expect(entry.allowedItems).toEqual(['Laptop']);
    expect(entry.reportingTime).toBeUndefined();
    expect(entry.rules).toEqual([]);
  });

  it('degrades to empty on malformed lists instead of throwing', () => {
    const entry = readEventExtras({
      entry_rules: 'not json at all',
      allowed_items: '{"not":"an array"}',
    } as never).entry;

    expect(entry.rules).toEqual([]);
    expect(entry.allowedItems).toEqual([]);
  });

  it('drops non-string entries from a list without shifting the rest', () => {
    const entry = readEventExtras({
      allowed_items: JSON.stringify(['Laptop', 42, null, 'Charger']),
    } as never).entry;

    expect(entry.allowedItems).toEqual(['Laptop', 'Charger']);
  });

  it('reports whether an organiser has filled in anything at all', () => {
    expect(hasEntryInfo(readEventExtras(undefined).entry)).toBe(false);
    expect(hasEntryInfo(readEventExtras({} as never).entry)).toBe(false);

    const oneField = readEventExtras(
      writeEventRegistration({ entry: { idProof: 'Institute ID card' } }),
    ).entry;
    expect(hasEntryInfo(oneField)).toBe(true);
  });

  it('keeps entry keys out of the window and the other extras', () => {
    const map = writeEventRegistration({
      startTime: '2026-06-03T09:00',
      rulebook: 'https://example.com',
      capacity: 60,
      entry: { idProof: 'Institute ID card', allowedItems: ['Pen'], rules: ['Be on time.'] },
    });

    expect(Object.keys(map).sort()).toEqual([
      'allowed_items',
      'capacity',
      'entry_rules',
      'id_proof',
      'rulebook',
      'start_time',
    ]);
  });
});
