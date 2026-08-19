import { describe, it, expect } from 'vitest';
import type { Event, ScheduleRound } from '@/api/types';
import {
  buildScheduleRows,
  categoryOf,
  dayKeyOf,
  durationLabel,
  groupSchedule,
  nowMarkerIndex,
  relativeLabel,
  roundStatus,
  scheduleCategories,
  scheduleDays,
  spanLabel,
} from './festSchedule';

const NOW = new Date(2026, 5, 11, 12, 0, 0);

/** A local ISO-ish string of the kind the event editor stores. */
const at = (hoursFromNow: number) => {
  const d = new Date(NOW.getTime() + hoursFromNow * 3_600_000);
  const pad = (n: number) => `${n}`.padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const round = (name: string, start: string, end = '', extra: Partial<ScheduleRound> = {}) => ({
  name,
  start_time: start,
  end_time: end,
  ...extra,
});

function event(id: string, schedule: ScheduleRound[], overrides: Partial<Event> = {}): Event {
  return {
    event_id: id,
    event_type: 'sports',
    name: id.toUpperCase(),
    description: '',
    team: { min: 1, max: 1, house: false, allow_single_registration: true },
    open: true,
    prize_money: [],
    registration: {},
    schedule,
    registration_fields: [],
    event_team: [],
    ...overrides,
  };
}

describe('buildScheduleRows', () => {
  it('flattens every event’s rounds into one timeline, soonest first', () => {
    const rows = buildScheduleRows(
      [
        event('e1', [round('Final', at(4)), round('Heat', at(1))]),
        event('e2', [round('Prelims', at(2))]),
      ],
      new Set(),
    );

    expect(rows.map((r) => r.roundName)).toEqual(['Heat', 'Prelims', 'Final']);
  });

  it('drops rounds whose start time cannot be parsed', () => {
    const rows = buildScheduleRows(
      [event('e1', [round('Good', at(1)), round('Bad', 'sometime after lunch')])],
      new Set(),
    );

    expect(rows.map((r) => r.roundName)).toEqual(['Good']);
  });

  it('treats an unparseable end time as no end at all', () => {
    const [row] = buildScheduleRows([event('e1', [round('Heat', at(1), 'later')])], new Set());
    expect(row.end).toBeNull();
  });

  it('marks the rounds of events the viewer is registered for', () => {
    const rows = buildScheduleRows(
      [event('e1', [round('Heat', at(1))]), event('e2', [round('Prelims', at(2))])],
      new Set(['e2']),
    );

    expect(rows.map((r) => r.mine)).toEqual([false, true]);
  });

  it('dresses a round in its catalogue category', () => {
    const [sports] = buildScheduleRows([event('e1', [round('Heat', at(1))])], new Set());
    expect(sports.categoryLabel).toBe('Sports');
    expect(sports.accent).toBe(categoryOf('sports').accent);
  });

  it('keeps an uncatalogued event type as its own label rather than borrowing one', () => {
    const [other] = buildScheduleRows(
      [event('e1', [round('Heat', at(1))], { event_type: 'others' })],
      new Set(),
    );
    expect(other.categoryLabel).toBe('others');
    expect(other.accent).not.toBe(categoryOf('sports').accent);
  });

  it('carries the round’s own description and venue when there are any', () => {
    const [row] = buildScheduleRows(
      [event('e1', [round('Heat', at(1), '', { description: ' Bring boots ', venue: '  ' })])],
      new Set(),
    );
    expect(row.description).toBe('Bring boots');
    expect(row.venue).toBeUndefined();
  });
});

describe('roundStatus', () => {
  const status = (startHours: number, endHours?: number) => {
    const [row] = buildScheduleRows(
      [event('e1', [round('R', at(startHours), endHours === undefined ? '' : at(endHours))])],
      new Set(),
    );
    return roundStatus(row, NOW.getTime());
  };

  it('reads a round that has not started as upcoming', () => {
    expect(status(2, 3)).toBe('upcoming');
  });

  it('reads a round inside its window as live', () => {
    expect(status(-1, 1)).toBe('live');
  });

  it('reads a finished round as past', () => {
    expect(status(-4, -2)).toBe('past');
  });

  it('keeps an open-ended round live for the admin board’s twelve hours, then drops it', () => {
    expect(status(-4)).toBe('live');
    expect(status(-13)).toBe('past');
  });
});

describe('day and category options', () => {
  it('derives a chip per day that actually has rounds', () => {
    const rows = buildScheduleRows(
      [event('e1', [round('A', at(1)), round('B', at(2)), round('C', at(25))])],
      new Set(),
    );
    const days = scheduleDays(rows);

    expect(days).toHaveLength(2);
    expect(days[0].count).toBe(2);
    expect(days[0].key).toBe(dayKeyOf(NOW));
    expect(days[0].dayNumber).toBe('11');
    expect(days[0].month).toBe('Jun');
  });

  it('lists each event type present exactly once', () => {
    const rows = buildScheduleRows(
      [
        event('e1', [round('A', at(1))]),
        event('e2', [round('B', at(2))], { event_type: 'culturals' }),
        event('e3', [round('C', at(3))]),
      ],
      new Set(),
    );

    expect(scheduleCategories(rows)).toEqual(['culturals', 'sports']);
  });
});

describe('groupSchedule', () => {
  it('puts rounds that start together on one slot and prints the day once', () => {
    const rows = buildScheduleRows(
      [
        event('e1', [round('Heat 1', at(1)), round('Heat 2', at(1))]),
        event('e2', [round('Prelims', at(3))]),
        event('e3', [round('Tomorrow', at(25))]),
      ],
      new Set(),
    );
    const groups = groupSchedule(rows);

    expect(groups).toHaveLength(2);
    expect(groups[0].slots).toHaveLength(2);
    expect(groups[0].slots[0].rows.map((r) => r.roundName)).toEqual(['Heat 1', 'Heat 2']);
    expect(groups[1].slots).toHaveLength(1);
  });

  it('keeps the slots of a day in time order', () => {
    const rows = buildScheduleRows(
      [event('e1', [round('Late', at(5)), round('Early', at(1))])],
      new Set(),
    );
    const [group] = groupSchedule(rows);

    expect(group.slots.map((s) => s.startMs)).toEqual(
      [...group.slots.map((s) => s.startMs)].sort(),
    );
  });
});

describe('nowMarkerIndex', () => {
  const groups = () =>
    groupSchedule(
      buildScheduleRows(
        [event('e1', [round('Done', at(-2)), round('Next', at(2)), round('Tomorrow', at(25))])],
        new Set(),
      ),
    );

  it('places the line between what has started and what has not', () => {
    expect(nowMarkerIndex(groups()[0], NOW.getTime(), dayKeyOf(NOW))).toBe(1);
  });

  it('places it below everything once the day is over', () => {
    const [group] = groups();
    expect(nowMarkerIndex(group, NOW.getTime() + 20 * 3_600_000, group.day.key)).toBe(
      group.slots.length,
    );
  });

  it('never draws a now line on a day that is not today', () => {
    expect(nowMarkerIndex(groups()[1], NOW.getTime(), dayKeyOf(NOW))).toBeNull();
  });
});

describe('time phrasing', () => {
  it('reads a span in the largest unit that still says something', () => {
    expect(spanLabel(45)).toBe('45 min');
    expect(spanLabel(60)).toBe('1 hr');
    expect(spanLabel(90)).toBe('1 hr 30 min');
    expect(spanLabel(48 * 60)).toBe('2 days');
  });

  it('gives a duration only when the organiser set an end time', () => {
    const [open, closed] = buildScheduleRows(
      [event('e1', [round('Open', at(1)), round('Closed', at(2), at(3.5))])],
      new Set(),
    );
    expect(durationLabel(open)).toBeNull();
    expect(durationLabel(closed)).toBe('1 hr 30 min');
  });

  it('phrases the future and the past differently', () => {
    const now = NOW.getTime();
    expect(relativeLabel(new Date(now + 45 * 60_000), now)).toBe('in 45 min');
    expect(relativeLabel(new Date(now - 45 * 60_000), now)).toBe('45 min ago');
    expect(relativeLabel(new Date(now + 10_000), now)).toBe('any moment');
  });
});
