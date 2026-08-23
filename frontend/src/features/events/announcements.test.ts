import type { Announcement } from '@/api/types';
import {
  draftToRequest,
  EMPTY_DRAFT,
  formatAnnouncementTime,
  MESSAGE_MAX,
  parseAnnouncementTime,
  priorityLabel,
  priorityTone,
  PRIORITIES,
  sortNewestFirst,
  validateDraft,
} from './announcements';

/**
 * Story 8.2's pure rules — mirrors `POST /events/{id}/announcements`
 * (`AnnouncementCreateRequest` in `backend/models.py`) exactly, on the same
 * principle `features/queries/queries.test.ts` documents: this module must
 * never accept a draft the backend would refuse, and never refuse one it
 * would accept.
 */

function announcement(overrides: Partial<Announcement> = {}): Announcement {
  return {
    announcement_id: 'ANN1',
    message: 'Report at 9am',
    priority: 'mid',
    created_by: 'BT1',
    created_at: '2026-08-20T09:00:00',
    ...overrides,
  };
}

describe('priorities', () => {
  it('mirrors ANNOUNCEMENT_PRIORITIES in backend/models.py', () => {
    expect(PRIORITIES.map((p) => p.value)).toEqual(['low', 'mid', 'high']);
  });

  it('labels every known priority', () => {
    expect(priorityLabel('low')).toBe('Low');
    expect(priorityLabel('mid')).toBe('Normal');
    expect(priorityLabel('high')).toBe('Urgent');
  });

  it('falls back to the raw value for an unknown priority rather than hiding it', () => {
    expect(priorityLabel('critical')).toBe('critical');
    expect(priorityTone('critical')).toBe('neutral');
  });

  it('tones high as a warning rather than a danger', () => {
    // An urgent announcement is not a fault in the app; red would misread as one.
    expect(priorityTone('high')).toBe('warning');
    expect(priorityTone('low')).toBe('neutral');
    expect(priorityTone('mid')).toBe('info');
  });
});

describe('validateDraft', () => {
  it('accepts a draft with a non-empty message, at the backend floor of 1 char', () => {
    expect(validateDraft({ message: 'm', priority: 'mid' })).toEqual({});
  });

  it('refuses an empty or whitespace-only message, same as the backend', () => {
    expect(validateDraft(EMPTY_DRAFT).message).toBeDefined();
    expect(validateDraft({ message: '   ', priority: 'mid' }).message).toBeDefined();
  });

  it('refuses a message past the UI ceiling', () => {
    const long = 'x'.repeat(MESSAGE_MAX + 1);
    expect(validateDraft({ message: long, priority: 'mid' }).message).toBeDefined();
  });

  it('accepts a message exactly at the ceiling', () => {
    const atLimit = 'x'.repeat(MESSAGE_MAX);
    expect(validateDraft({ message: atLimit, priority: 'high' })).toEqual({});
  });
});

describe('draftToRequest', () => {
  it('trims the message and carries the chosen priority', () => {
    const request = draftToRequest({ message: '  Report at 9am  ', priority: 'high' });
    expect(request).toEqual({ message: 'Report at 9am', priority: 'high' });
  });

  it('returns null for a draft that would be refused', () => {
    expect(draftToRequest(EMPTY_DRAFT)).toBeNull();
  });
});

describe('sortNewestFirst', () => {
  it('orders by created_at, most recent first', () => {
    const older = announcement({ announcement_id: 'ANN1', created_at: '2026-08-20T09:00:00' });
    const newer = announcement({ announcement_id: 'ANN2', created_at: '2026-08-20T10:00:00' });
    expect(sortNewestFirst([older, newer]).map((a) => a.announcement_id)).toEqual([
      'ANN2',
      'ANN1',
    ]);
  });

  it('does not mutate the input array', () => {
    const rows = [announcement({ announcement_id: 'A' }), announcement({ announcement_id: 'B' })];
    const copy = [...rows];
    sortNewestFirst(rows);
    expect(rows).toEqual(copy);
  });
});

describe('timestamp handling', () => {
  it('reads a naive backend timestamp as UTC rather than local', () => {
    // No offset — the backend's own `datetime.utcnow()` serialisation. Read as
    // local (ECMAScript's default for an offset-less string) this would land 5½
    // hours later in India.
    const date = parseAnnouncementTime('2026-08-20T09:00:00');
    expect(date?.toISOString()).toBe('2026-08-20T09:00:00.000Z');
  });

  it('leaves an already-aware timestamp alone', () => {
    const date = parseAnnouncementTime('2026-08-20T09:00:00+05:30');
    expect(date?.toISOString()).toBe('2026-08-20T03:30:00.000Z');
  });

  it('returns null for an empty or unparseable value, never an epoch date', () => {
    expect(parseAnnouncementTime(null)).toBeNull();
    expect(parseAnnouncementTime('')).toBeNull();
    expect(parseAnnouncementTime('not a date')).toBeNull();
  });

  it('formats a valid timestamp and passes an unparseable one through unchanged', () => {
    expect(formatAnnouncementTime('2026-08-20T09:00:00')).not.toBe('');
    expect(formatAnnouncementTime('not a date')).toBe('not a date');
    expect(formatAnnouncementTime(null)).toBe('');
  });
});
