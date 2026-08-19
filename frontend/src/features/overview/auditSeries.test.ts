import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import type { AuditLogEntry } from '@/api/types';
import {
  activityPulse,
  bucketByDay,
  bucketByHour,
  localDayKey,
  mealMatrix,
  openAccommodationRequests,
  parseLogTime,
  rowsOnDay,
  rowsSince,
  uniqueActors,
  uniqueSubjects,
} from './auditSeries';

function entry(overrides: Partial<AuditLogEntry> & { timestamp: string }): AuditLogEntry {
  return {
    actor_id: 'DS23F1000001',
    action: 'MESS_SCAN',
    target_id: null,
    details: {},
    ...overrides,
  };
}

describe('parseLogTime', () => {
  it('reads an offset-less backend timestamp as UTC, not local time', () => {
    // `datetime.utcnow()` serialises without a designator. Reading it as local
    // time shifts every row by the viewer's offset, which is enough to file an
    // evening meal under the following morning.
    const naive = parseLogTime('2026-08-18T10:23:45.123000');
    const explicit = parseLogTime('2026-08-18T10:23:45.123Z');
    expect(naive?.getTime()).toBe(explicit?.getTime());
  });

  it('respects an explicit offset when one is present', () => {
    expect(parseLogTime('2026-08-18T10:00:00+05:30')?.toISOString()).toBe(
      '2026-08-18T04:30:00.000Z',
    );
  });

  it('returns null rather than an Invalid Date', () => {
    expect(parseLogTime('not a date')).toBeNull();
    expect(parseLogTime('')).toBeNull();
  });
});

describe('rowsOnDay', () => {
  it('keeps only rows falling on the given local day', () => {
    const day = new Date(2026, 7, 18, 12, 0, 0);
    const onDay = new Date(2026, 7, 18, 9, 30, 0).toISOString();
    const nextDay = new Date(2026, 7, 19, 9, 30, 0).toISOString();

    const kept = rowsOnDay([entry({ timestamp: onDay }), entry({ timestamp: nextDay })], day);
    expect(kept).toHaveLength(1);
    expect(kept[0].timestamp).toBe(onDay);
  });

  it('drops unparseable rows instead of counting them', () => {
    expect(rowsOnDay([entry({ timestamp: 'rubbish' })], new Date())).toHaveLength(0);
  });
});

describe('rowsSince', () => {
  it('keeps rows inside the window and drops older ones', () => {
    const now = new Date('2026-08-18T12:00:00Z');
    const rows = [
      entry({ timestamp: '2026-08-18T11:50:00Z' }),
      entry({ timestamp: '2026-08-18T11:30:00Z' }),
    ];
    expect(rowsSince(rows, 20, now)).toHaveLength(1);
  });
});

describe('bucketByHour', () => {
  // Built from local components rather than a UTC literal: buckets and their
  // axis labels are local clock hours, so a fixed `Z` time would land in a
  // different bucket in a half-hour-offset zone like IST than in UTC.
  const now = new Date(2026, 7, 18, 12, 30, 0);
  /** `minutesPast` into the hour `hoursAgo` before `now`. */
  const at = (hoursAgo: number, minutesPast = 5) =>
    new Date(2026, 7, 18, 12 - hoursAgo, minutesPast, 0).toISOString();

  it('emits one bucket per hour including empty ones', () => {
    // A gap in a trend line is a claim that nothing happened; it has to be drawn.
    const buckets = bucketByHour([entry({ timestamp: at(0) })], 4, now);
    expect(buckets).toHaveLength(4);
    expect(buckets.map((b) => b.value)).toEqual([0, 0, 0, 1]);
  });

  it('files a row under the hour it happened in, not the one it is near', () => {
    // 11:05 belongs to the 11:00 bucket even though it is inside sixty minutes
    // of 12:00 — the distinction that decides whether the newest hour reads true.
    const buckets = bucketByHour([entry({ timestamp: at(1) })], 4, now);
    expect(buckets.map((b) => b.value)).toEqual([0, 0, 1, 0]);
  });

  it('keeps the current partial hour in the last bucket', () => {
    const buckets = bucketByHour([entry({ timestamp: at(0, 59) })], 4, now);
    expect(buckets[buckets.length - 1].value).toBe(1);
  });

  it('ignores rows older than the window', () => {
    const buckets = bucketByHour([entry({ timestamp: at(30) })], 4, now);
    expect(buckets.every((b) => b.value === 0)).toBe(true);
  });
});

describe('bucketByDay', () => {
  it('returns days in chronological order', () => {
    const rows = [
      entry({ timestamp: new Date(2026, 7, 19, 10).toISOString() }),
      entry({ timestamp: new Date(2026, 7, 17, 10).toISOString() }),
      entry({ timestamp: new Date(2026, 7, 17, 18).toISOString() }),
    ];
    const buckets = bucketByDay(rows);
    expect(buckets.map((b) => b.label)).toEqual([
      localDayKey(new Date(2026, 7, 17)),
      localDayKey(new Date(2026, 7, 19)),
    ]);
    expect(buckets[0].value).toBe(2);
  });
});

describe('uniqueActors / uniqueSubjects', () => {
  it('counts each actor once', () => {
    const rows = [
      entry({ timestamp: '2026-08-18T10:00:00Z', actor_id: 'A' }),
      entry({ timestamp: '2026-08-18T11:00:00Z', actor_id: 'A' }),
      entry({ timestamp: '2026-08-18T11:00:00Z', actor_id: 'B' }),
    ];
    expect(uniqueActors(rows).size).toBe(2);
  });

  it('reads the scanned participant out of details', () => {
    const rows = [
      entry({ timestamp: '2026-08-18T10:00:00Z', details: { participant_id: 'P1' } }),
      entry({ timestamp: '2026-08-18T10:05:00Z', details: { participant_id: 'P1' } }),
      entry({ timestamp: '2026-08-18T10:06:00Z', details: {} }),
    ];
    expect(uniqueSubjects(rows).size).toBe(1);
  });
});

describe('mealMatrix', () => {
  const rows = [
    entry({ timestamp: '2026-08-18T02:00:00Z', details: { day: 1, slot: 'breakfast' } }),
    entry({ timestamp: '2026-08-18T02:05:00Z', details: { day: 1, slot: 'breakfast' } }),
    entry({ timestamp: '2026-08-18T07:00:00Z', details: { day: 1, slot: 'lunch' } }),
    entry({ timestamp: '2026-08-19T14:00:00Z', details: { day: 2, slot: 'dinner' } }),
  ];

  it('builds a day by slot grid keyed on the fest day number', () => {
    const matrix = mealMatrix(rows);
    expect(matrix.days).toEqual(['Day 1', 'Day 2']);
    expect(matrix.total).toBe(4);
    expect(matrix.bySlot).toEqual({ breakfast: 2, lunch: 1, dinner: 1 });
  });

  it('emits a cell for every day and slot pair, zero included', () => {
    const matrix = mealMatrix(rows);
    expect(matrix.cells).toHaveLength(6);
    expect(matrix.cells.find((c) => c.row === 'Day 1' && c.column === 'breakfast')?.value).toBe(2);
    expect(matrix.cells.find((c) => c.row === 'Day 2' && c.column === 'lunch')?.value).toBe(0);
  });

  it('skips rows missing a day or a recognised slot rather than inventing a sitting', () => {
    const matrix = mealMatrix([
      entry({ timestamp: '2026-08-18T02:00:00Z', details: { slot: 'breakfast' } }),
      entry({ timestamp: '2026-08-18T02:00:00Z', details: { day: 1, slot: 'brunch' } }),
    ]);
    expect(matrix.total).toBe(0);
    expect(matrix.days).toEqual([]);
  });
});

describe('openAccommodationRequests', () => {
  it('counts a participant whose latest action is a registration', () => {
    const open = openAccommodationRequests([
      entry({
        timestamp: '2026-08-10T10:00:00Z',
        actor_id: 'P1',
        action: 'ACCOMMODATION_REGISTER',
      }),
    ]);
    expect([...open]).toEqual(['P1']);
  });

  it('drops one who cancelled afterwards', () => {
    const open = openAccommodationRequests([
      entry({
        timestamp: '2026-08-10T10:00:00Z',
        actor_id: 'P1',
        action: 'ACCOMMODATION_REGISTER',
      }),
      entry({ timestamp: '2026-08-11T10:00:00Z', actor_id: 'P1', action: 'ACCOMMODATION_CANCEL' }),
    ]);
    expect(open.size).toBe(0);
  });

  it('counts one who registered again after cancelling', () => {
    const open = openAccommodationRequests([
      entry({ timestamp: '2026-08-11T10:00:00Z', actor_id: 'P1', action: 'ACCOMMODATION_CANCEL' }),
      entry({
        timestamp: '2026-08-12T10:00:00Z',
        actor_id: 'P1',
        action: 'ACCOMMODATION_REGISTER',
      }),
    ]);
    expect(open.size).toBe(1);
  });

  it('ignores unrelated actions', () => {
    const open = openAccommodationRequests([
      entry({ timestamp: '2026-08-10T10:00:00Z', actor_id: 'P1', action: 'EVENT_REGISTER' }),
    ]);
    expect(open.size).toBe(0);
  });
});

describe('activityPulse', () => {
  const now = new Date(2026, 7, 18, 12, 30, 0);

  function rowsAtHoursAgo(counts: number[]): AuditLogEntry[] {
    // counts[0] is 6 hours ago … counts[6] is the current hour. Built from local
    // components so each row lands in the local clock hour it names.
    return counts.flatMap((count, index) => {
      const hoursAgo = counts.length - 1 - index;
      const at = new Date(2026, 7, 18, 12 - hoursAgo, 5, 0).toISOString();
      return Array.from({ length: count }, () => entry({ timestamp: at }));
    });
  }

  it('flags an hour running more than three times the median', () => {
    const pulse = activityPulse(rowsAtHoursAgo([2, 2, 2, 2, 2, 2, 20]), now);
    expect(pulse.lastHour).toBe(20);
    expect(pulse.baseline).toBe(2);
    expect(pulse.spiking).toBe(true);
  });

  it('does not flag an hour merely above the median', () => {
    const pulse = activityPulse(rowsAtHoursAgo([2, 2, 2, 2, 2, 2, 5]), now);
    expect(pulse.spiking).toBe(false);
  });

  it('never spikes against a zero baseline', () => {
    // At the very start of the fest everything is infinitely above nothing, and
    // firing on that trains an admin to ignore the strip.
    const pulse = activityPulse(rowsAtHoursAgo([0, 0, 0, 0, 0, 0, 40]), now);
    expect(pulse.baseline).toBe(0);
    expect(pulse.spiking).toBe(false);
  });
});

describe('localDayKey', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('pads month and day', () => {
    expect(localDayKey(new Date(2026, 0, 5))).toBe('2026-01-05');
  });
});
