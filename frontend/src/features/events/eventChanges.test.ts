import { describe, it, expect, beforeEach } from 'vitest';
import type { Event, MyEventRegistration, ScheduleRound } from '@/api/types';
import {
  clearEventWatch,
  dismissAllEventChanges,
  dismissEventChange,
  EMPTY_WATCH,
  readEventWatch,
  reconcile,
  registeredEvents,
  saveEventWatch,
  syncEventChanges,
  withoutChange,
  type EventWatch,
} from './eventChanges';

const NOTICED = '2026-06-01T10:00:00.000Z';

function round(overrides: Partial<ScheduleRound> = {}): ScheduleRound {
  return {
    round_id: 'RND1',
    name: 'Round 1',
    start_time: '2026-06-10T10:00',
    end_time: '2026-06-10T12:00',
    venue: 'KV Ground',
    ...overrides,
  };
}

function event(overrides: Partial<Event> = {}): Event {
  return {
    event_id: 'hack-2026',
    event_type: 'technical',
    name: 'Hackathon 2026',
    description: '',
    poster: '',
    team: { min: 1, max: 1, house_vs_house_event: false, allow_single_registration: true },
    prize_money: [],
    registration: {},
    schedule: [round()],
    registration_fields: [],
    event_team: [],
    ...overrides,
  };
}

/** The watch record a device would hold after seeing `events` once. */
function baseline(events: Event[]): EventWatch {
  return reconcile(null, events, NOTICED).record;
}

describe('reconcile — baselining', () => {
  it('raises nothing the first time an event is seen', () => {
    const { record, fresh } = reconcile(null, [event()], NOTICED);
    expect(fresh).toEqual([]);
    expect(record.pending).toEqual([]);
    expect(Object.keys(record.seen)).toEqual(['hack-2026']);
  });

  it('raises nothing when nothing moved', () => {
    const { fresh } = reconcile(baseline([event()]), [event()], NOTICED);
    expect(fresh).toEqual([]);
  });

  it('treats a newly registered event as a baseline, not a change', () => {
    const before = baseline([event()]);
    const second = event({ event_id: 'quiz', name: 'Quiz' });
    const { fresh } = reconcile(before, [event(), second], NOTICED);
    expect(fresh).toEqual([]);
  });
});

describe('reconcile — venue and time changes', () => {
  it('reports a venue move with both sides', () => {
    const moved = event({ schedule: [round({ venue: 'CLT' })] });
    const { fresh } = reconcile(baseline([event()]), [moved], NOTICED);

    expect(fresh).toHaveLength(1);
    expect(fresh[0]).toMatchObject({
      eventId: 'hack-2026',
      eventName: 'Hackathon 2026',
      roundName: 'Round 1',
      field: 'venue',
      from: 'KV Ground',
      to: 'CLT',
      noticedAt: NOTICED,
    });
  });

  it('reports a start and an end time move separately', () => {
    const moved = event({
      schedule: [round({ start_time: '2026-06-10T14:00', end_time: '2026-06-10T16:00' })],
    });
    const { fresh } = reconcile(baseline([event()]), [moved], NOTICED);

    expect(fresh.map((c) => c.field).sort()).toEqual(['end', 'start']);
  });

  it('reports a change on the right round when an event has several', () => {
    const two = [round(), round({ round_id: 'RND2', name: 'Finals', venue: 'CLT' })];
    const before = baseline([event({ schedule: two })]);

    const moved = event({
      schedule: [two[0], { ...two[1], venue: 'Stadium' }],
    });
    const { fresh } = reconcile(before, [moved], NOTICED);

    expect(fresh).toHaveLength(1);
    expect(fresh[0].roundName).toBe('Finals');
    expect(fresh[0].to).toBe('Stadium');
  });

  it('matches rounds by round_id, so reordering is not mistaken for a move', () => {
    const a = round({ round_id: 'RND1', name: 'Heats', venue: 'KV Ground' });
    const b = round({ round_id: 'RND2', name: 'Finals', venue: 'CLT' });
    const before = baseline([event({ schedule: [a, b] })]);

    // Same two rounds, swapped in the array.
    const { fresh } = reconcile(before, [event({ schedule: [b, a] })], NOTICED);
    expect(fresh).toEqual([]);
  });

  it('falls back to position when rounds carry no round_id', () => {
    const noId = round({ round_id: undefined });
    const before = baseline([event({ schedule: [noId] })]);
    const moved = event({ schedule: [{ ...noId, venue: 'CLT' }] });

    const { fresh } = reconcile(before, [moved], NOTICED);
    expect(fresh).toHaveLength(1);
    expect(fresh[0].field).toBe('venue');
  });

  it('reports a venue being set for the first time, with an empty "from"', () => {
    const before = baseline([event({ schedule: [round({ venue: '' })] })]);
    const { fresh } = reconcile(before, [event()], NOTICED);

    expect(fresh).toHaveLength(1);
    expect(fresh[0]).toMatchObject({ field: 'venue', from: '', to: 'KV Ground' });
  });

  it('stays quiet when an organiser clears a field rather than moving it', () => {
    // "Venue removed" tells a participant nothing about where to be, so it is
    // recorded but not announced.
    const before = baseline([event()]);
    const cleared = event({ schedule: [round({ venue: '' })] });

    const { fresh, record } = reconcile(before, [cleared], NOTICED);
    expect(fresh).toEqual([]);
    expect(record.seen['hack-2026'].rounds[0].venue).toBe('');
  });

  it('ignores a round being added or removed', () => {
    const before = baseline([event()]);
    const extra = event({ schedule: [round(), round({ round_id: 'RND2', name: 'Finals' })] });

    expect(reconcile(before, [extra], NOTICED).fresh).toEqual([]);
    expect(reconcile(before, [event({ schedule: [] })], NOTICED).fresh).toEqual([]);
  });
});

describe('reconcile — pending list', () => {
  it('keeps an alert outstanding across reloads without duplicating it', () => {
    const moved = event({ schedule: [round({ venue: 'CLT' })] });

    const first = reconcile(baseline([event()]), [moved], NOTICED);
    expect(first.record.pending).toHaveLength(1);

    // Same data again — the change is already known, so nothing is appended.
    const second = reconcile(first.record, [moved], NOTICED);
    expect(second.fresh).toEqual([]);
    expect(second.record.pending).toHaveLength(1);
  });

  it('records a second, different move on the same field', () => {
    const first = reconcile(
      baseline([event()]),
      [event({ schedule: [round({ venue: 'CLT' })] })],
      NOTICED,
    );
    const second = reconcile(
      first.record,
      [event({ schedule: [round({ venue: 'Stadium' })] })],
      NOTICED,
    );

    expect(second.record.pending.map((c) => c.to)).toEqual(['Stadium', 'CLT']);
  });

  it('newest alert first', () => {
    const withVenue = reconcile(
      baseline([event()]),
      [event({ schedule: [round({ venue: 'CLT' })] })],
      NOTICED,
    );
    const withTime = reconcile(
      withVenue.record,
      [event({ schedule: [round({ venue: 'CLT', start_time: '2026-06-10T14:00' })] })],
      NOTICED,
    );

    expect(withTime.record.pending[0].field).toBe('start');
  });

  it('drops alerts for an event the participant has cancelled', () => {
    const moved = event({ schedule: [round({ venue: 'CLT' })] });
    const withAlert = reconcile(baseline([event()]), [moved], NOTICED);
    expect(withAlert.record.pending).toHaveLength(1);

    const afterCancel = reconcile(withAlert.record, [], NOTICED);
    expect(afterCancel.record.pending).toEqual([]);
    expect(afterCancel.record.seen).toEqual({});
  });

  it('forgets an event that no longer exists', () => {
    const before = baseline([event(), event({ event_id: 'quiz', name: 'Quiz' })]);
    const { record } = reconcile(before, [event()], NOTICED);
    expect(Object.keys(record.seen)).toEqual(['hack-2026']);
  });
});

describe('withoutChange', () => {
  it('removes one alert and leaves the rest', () => {
    const { record } = reconcile(
      baseline([event()]),
      [event({ schedule: [round({ venue: 'CLT', start_time: '2026-06-10T14:00' })] })],
      NOTICED,
    );
    expect(record.pending).toHaveLength(2);

    const next = withoutChange(record, record.pending[0].id);
    expect(next.pending).toHaveLength(1);
    expect(next.pending[0].id).toBe(record.pending[1].id);
  });

  it('is a no-op for an id that is not there', () => {
    expect(withoutChange(EMPTY_WATCH, 'nope').pending).toEqual([]);
  });
});

describe('registeredEvents', () => {
  it('keeps only the events the participant holds a registration for', () => {
    const all = [event(), event({ event_id: 'quiz', name: 'Quiz' })];
    const mine: MyEventRegistration[] = [
      { event_id: 'quiz', team_id: null, team_role: null, registration_data: {} },
    ];
    expect(registeredEvents(all, mine).map((e) => e.event_id)).toEqual(['quiz']);
  });
});

describe('storage', () => {
  const participant = 'p-1';

  beforeEach(() => clearEventWatch(participant));

  it('round-trips a record', () => {
    const record = baseline([event()]);
    saveEventWatch(participant, record);
    expect(readEventWatch(participant)).toEqual(record);
  });

  it('reads a missing record as no history', () => {
    expect(readEventWatch(participant)).toBeNull();
  });

  it('discards a malformed or future-schema record instead of throwing', () => {
    for (const raw of ['not json', '{}', '{"v":2,"seen":{},"pending":[]}', '{"v":1,"seen":{}}']) {
      localStorage.setItem(`pc_event_watch_v1:${participant}`, raw);
      expect(readEventWatch(participant)).toBeNull();
    }
  });

  it('keeps two participants on one device apart', () => {
    saveEventWatch('p-1', baseline([event()]));
    expect(readEventWatch('p-2')).toBeNull();
    clearEventWatch('p-1');
  });
});

describe('syncEventChanges', () => {
  const participant = 'p-sync';
  const mine: MyEventRegistration[] = [
    { event_id: 'hack-2026', team_id: null, team_role: null, registration_data: {} },
  ];

  beforeEach(() => clearEventWatch(participant));

  it('returns nothing on a first load and the change on the next', () => {
    expect(syncEventChanges(participant, [event()], mine)).toEqual([]);

    const moved = [event({ schedule: [round({ venue: 'CLT' })] })];
    const alerts = syncEventChanges(participant, moved, mine);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].to).toBe('CLT');
  });

  it('is idempotent — running twice on the same data records one alert', () => {
    syncEventChanges(participant, [event()], mine);
    const moved = [event({ schedule: [round({ venue: 'CLT' })] })];

    expect(syncEventChanges(participant, moved, mine)).toHaveLength(1);
    expect(syncEventChanges(participant, moved, mine)).toHaveLength(1);
  });

  it('ignores events the participant is not registered for', () => {
    syncEventChanges(participant, [event()], []);
    const moved = [event({ schedule: [round({ venue: 'CLT' })] })];
    expect(syncEventChanges(participant, moved, [])).toEqual([]);
  });

  it('does nothing without a participant id', () => {
    expect(syncEventChanges('', [event()], mine)).toEqual([]);
  });

  it('dismissal survives the next load', () => {
    syncEventChanges(participant, [event()], mine);
    const moved = [event({ schedule: [round({ venue: 'CLT' })] })];
    const alerts = syncEventChanges(participant, moved, mine);

    expect(dismissEventChange(participant, alerts[0].id)).toEqual([]);
    // The dismissed change must not come back on the next reload.
    expect(syncEventChanges(participant, moved, mine)).toEqual([]);
  });

  it('dismisses everything at once', () => {
    syncEventChanges(participant, [event()], mine);
    const moved = [event({ schedule: [round({ venue: 'CLT', start_time: '2026-06-10T14:00' })] })];
    expect(syncEventChanges(participant, moved, mine)).toHaveLength(2);

    expect(dismissAllEventChanges(participant)).toEqual([]);
    expect(syncEventChanges(participant, moved, mine)).toEqual([]);
  });

  it('dismissing with no record stored is harmless', () => {
    expect(dismissEventChange('nobody', 'x')).toEqual([]);
    expect(dismissAllEventChanges('nobody')).toEqual([]);
  });
});
