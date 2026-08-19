import { describe, it, expect } from 'vitest';
import {
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
