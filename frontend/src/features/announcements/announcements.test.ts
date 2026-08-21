import { describe, expect, it } from 'vitest';
import type { Event, Hostel, Mess, MyEventRegistration } from '@/api/types';
import { readEventExtras, writeEventRegistration } from '@/features/events/eventExtras';
import {
  audienceLabel,
  collectAnnouncements,
  createAnnouncement,
  encodeAudience,
  isLive,
  matchesAudience,
  parseAudience,
  participantReader,
  readAnnouncements,
  registrationWithAnnouncements,
  staffReader,
  validateAnnouncement,
  visibleTo,
  writeAnnouncementsValue,
  MAX_ANNOUNCEMENTS_PER_EVENT,
  type Announcement,
  type Audience,
} from './announcements';

/** A stored notice, as it sits inside the registration map. */
function stored(overrides: Record<string, unknown> = {}) {
  return {
    id: 'AN-1',
    title: 'Round 2 moved',
    body: 'Now at CLT.',
    audience: 'everyone',
    severity: 'important',
    posted_at: '2026-06-10T09:00:00.000Z',
    ...overrides,
  };
}

function mapWith(rows: unknown[]): Event['registration'] {
  return { announcements: JSON.stringify(rows) } as never;
}

function announcement(overrides: Partial<Announcement> = {}): Announcement {
  return {
    id: 'AN-1',
    title: 'Round 2 moved',
    body: 'Now at CLT.',
    audience: { kind: 'everyone' },
    severity: 'info',
    postedAt: '2026-06-10T09:00:00.000Z',
    carrierEventId: 'hackathon',
    ...overrides,
  };
}

function event(overrides: Partial<Event> = {}): Event {
  return {
    event_id: 'hackathon',
    event_type: 'technical',
    name: 'Hackathon',
    description: '',
    team: { min: 1, max: 1, house: false, allow_single_registration: true },
    open: true,
    prize_money: [],
    registration: {},
    schedule: [],
    registration_fields: [],
    event_team: [],
    ...overrides,
  };
}

describe('audience encoding', () => {
  it('round-trips every arm through a single string', () => {
    const all: Audience[] = [
      { kind: 'everyone' },
      { kind: 'participants' },
      { kind: 'staff' },
      { kind: 'event', id: 'hackathon' },
      { kind: 'house', id: 'Nilgiri House' },
      { kind: 'hostel', id: 'H12' },
      { kind: 'mess', id: 'M3' },
      { kind: 'event_team', id: 'hackathon' },
      { kind: 'hostel_team', id: 'H12' },
      { kind: 'mess_team', id: 'M3' },
    ];

    for (const audience of all) {
      expect(parseAudience(encodeAudience(audience))).toEqual(audience);
    }
  });

  it('keeps an id that itself contains a colon', () => {
    expect(parseAudience('house:Nilgiri: House')).toEqual({
      kind: 'house',
      id: 'Nilgiri: House',
    });
  });

  it('refuses an unknown selector rather than defaulting to everyone', () => {
    // Reading an unrecognised audience as "everyone" would broadcast a notice
    // that was addressed to one block.
    expect(parseAudience('all_the_people')).toBeNull();
    expect(parseAudience('planet:earth')).toBeNull();
    expect(parseAudience('')).toBeNull();
    expect(parseAudience(undefined)).toBeNull();
  });

  it('refuses a scoped arm with no id, and a global arm is not scoped', () => {
    expect(parseAudience('house:')).toBeNull();
    expect(parseAudience('house:   ')).toBeNull();
    expect(parseAudience('everyone:H12')).toBeNull();
  });

  it('drops the redundant House suffix when labelling a house', () => {
    expect(audienceLabel({ kind: 'house', id: 'Nilgiri House' })).toBe('House Nilgiri');
  });

  it('labels a scoped audience by name, falling back to the raw id', () => {
    expect(audienceLabel({ kind: 'event', id: 'hackathon' }, { hackathon: 'Hackathon' })).toBe(
      'Registered for Hackathon',
    );
    expect(audienceLabel({ kind: 'hostel', id: 'H12' })).toBe('Residents of H12');
  });
});

describe('reading notices out of the registration map', () => {
  it('parses a stored notice into the shape the app works with', () => {
    const [found] = readAnnouncements(mapWith([stored({ posted_by: 'Ops Head' })]), 'hackathon');

    expect(found).toEqual({
      id: 'AN-1',
      title: 'Round 2 moved',
      body: 'Now at CLT.',
      audience: { kind: 'everyone' },
      severity: 'important',
      postedAt: '2026-06-10T09:00:00.000Z',
      postedBy: 'Ops Head',
      carrierEventId: 'hackathon',
    });
  });

  it('returns nothing when the event carries no announcements key', () => {
    expect(readAnnouncements({}, 'hackathon')).toEqual([]);
    expect(readAnnouncements(undefined, 'hackathon')).toEqual([]);
  });

  it('degrades to absent on malformed data instead of throwing', () => {
    expect(readAnnouncements({ announcements: 'not json' } as never, 'hackathon')).toEqual([]);
    expect(
      readAnnouncements({ announcements: '{"not":"an array"}' } as never, 'hackathon'),
    ).toEqual([]);
    expect(readAnnouncements(mapWith(['a string', 42, null]), 'hackathon')).toEqual([]);
  });

  it('drops a row missing anything it would need to render', () => {
    const rows = [
      stored({ id: '' }),
      stored({ title: '   ' }),
      stored({ body: '' }),
      stored({ posted_at: '' }),
      stored({ audience: 'nonsense' }),
    ];
    expect(readAnnouncements(mapWith(rows), 'hackathon')).toEqual([]);
  });

  it('reads an unknown severity as info rather than dropping the notice', () => {
    const [found] = readAnnouncements(mapWith([stored({ severity: 'catastrophic' })]), 'hackathon');
    expect(found.severity).toBe('info');
    expect(found.title).toBe('Round 2 moved');
  });

  it('keeps only the first of two rows sharing an id', () => {
    const rows = [stored({ title: 'First' }), stored({ title: 'Second' })];
    const found = readAnnouncements(mapWith(rows), 'hackathon');
    expect(found).toHaveLength(1);
    expect(found[0].title).toBe('First');
  });

  it('stamps the carrier event onto every row it reads', () => {
    const [found] = readAnnouncements(mapWith([stored()]), 'robowars');
    expect(found.carrierEventId).toBe('robowars');
  });
});

describe('writing notices back', () => {
  it('round-trips through the map', () => {
    const original = announcement({ audience: { kind: 'house', id: 'Gir House' } });
    const map = registrationWithAnnouncements({}, [original]);
    expect(readAnnouncements(map as never, 'hackathon')).toEqual([original]);
  });

  it('writes no key at all for an empty list, rather than "[]"', () => {
    expect(writeAnnouncementsValue([])).toBeUndefined();
    expect(registrationWithAnnouncements({ start_time: '1 Jun' } as never, [])).toEqual({
      start_time: '1 Jun',
    });
  });

  it('removes the key when the last notice is withdrawn', () => {
    const withOne = registrationWithAnnouncements({}, [announcement()]);
    expect(withOne).toHaveProperty('announcements');
    expect(registrationWithAnnouncements(withOne as never, [])).not.toHaveProperty('announcements');
  });

  it('preserves every other key in the map byte for byte', () => {
    // The composer has no business normalising an event's FAQs on the way past.
    const existing = {
      start_time: '1 Jun',
      end_time: '9 Jun',
      capacity: '200',
      faqs: '[{"q":"Fee?","a":"None"}]',
      'options:team_size': '["2","3"]',
    } as unknown as Event['registration'];

    const next = registrationWithAnnouncements(existing, [announcement()]);
    expect(next.start_time).toBe('1 Jun');
    expect(next.capacity).toBe('200');
    expect(next.faqs).toBe('[{"q":"Fee?","a":"None"}]');
    expect(next['options:team_size']).toBe('["2","3"]');
  });

  it('keeps the newest notices when the cap is passed', () => {
    const many = Array.from({ length: MAX_ANNOUNCEMENTS_PER_EVENT + 5 }, (_, i) =>
      announcement({
        id: `AN-${i}`,
        // Later index = later timestamp, so index 0 is the oldest.
        postedAt: `2026-06-${String(10 + Math.floor(i / 10))}T0${i % 10}:00:00.000Z`,
      }),
    );
    const kept = readAnnouncements(registrationWithAnnouncements({}, many) as never, 'hackathon');

    expect(kept).toHaveLength(MAX_ANNOUNCEMENTS_PER_EVENT);
    expect(kept.map((a) => a.id)).not.toContain('AN-0');
  });

  it('survives an event edit, because the editor carries the blob opaquely', () => {
    // `AdminEventEditorPage.save()` rebuilds the map from scratch. If it did not
    // hold on to this key, editing an event's capacity would un-send its notices.
    const withNotice = registrationWithAnnouncements({}, [announcement()]);
    const extras = readEventExtras(withNotice as never);
    const rebuilt = writeEventRegistration({
      startTime: '1 Jun',
      capacity: 200,
      announcementsRaw: extras.announcementsRaw,
    });

    expect(readAnnouncements(rebuilt as never, 'hackathon')).toEqual([announcement()]);
  });
});

describe('who a notice reaches', () => {
  const reader = participantReader({
    id: 'DS23F1000042',
    house: 'Nilgiri House',
    registrations: [{ event_id: 'hackathon' }] as MyEventRegistration[],
    hostelId: 'H12',
    messId: 'M3',
  });

  it('delivers a fest-wide notice to a participant and to staff alike', () => {
    const staff = staffReader({ id: 'BT1' });
    expect(matchesAudience({ kind: 'everyone' }, reader)).toBe(true);
    expect(matchesAudience({ kind: 'everyone' }, staff)).toBe(true);
  });

  it('reaches only the participants registered for an event — Story 8.2', () => {
    expect(matchesAudience({ kind: 'event', id: 'hackathon' }, reader)).toBe(true);
    expect(matchesAudience({ kind: 'event', id: 'robowars' }, reader)).toBe(false);
  });

  it('matches a house case-insensitively, because profile.house is free text', () => {
    expect(matchesAudience({ kind: 'house', id: 'nilgiri house' }, reader)).toBe(true);
    expect(matchesAudience({ kind: 'house', id: 'Gir House' }, reader)).toBe(false);
  });

  it('reaches the residents of a block and the diners at a hall', () => {
    expect(matchesAudience({ kind: 'hostel', id: 'H12' }, reader)).toBe(true);
    expect(matchesAudience({ kind: 'mess', id: 'M3' }, reader)).toBe(true);
    expect(matchesAudience({ kind: 'hostel', id: 'H99' }, reader)).toBe(false);
    expect(matchesAudience({ kind: 'mess', id: 'M9' }, reader)).toBe(false);
  });

  it('never crosses a participant arm with a staff arm', () => {
    // The same human may hold both accounts, but the two sessions are different
    // ids from different collections and are asking different questions.
    expect(matchesAudience({ kind: 'staff' }, reader)).toBe(false);
    expect(matchesAudience({ kind: 'event_team', id: 'hackathon' }, reader)).toBe(false);

    const staff = staffReader({ id: 'BT1', events: [event({ event_team: [] })] });
    expect(matchesAudience({ kind: 'participants' }, staff)).toBe(false);
    expect(matchesAudience({ kind: 'event', id: 'hackathon' }, staff)).toBe(false);
  });

  it('leaves an unallocated participant out of block and hall notices', () => {
    const fresh = participantReader({ id: 'DS23F1000043' });
    expect(matchesAudience({ kind: 'hostel', id: 'H12' }, fresh)).toBe(false);
    expect(matchesAudience({ kind: 'mess', id: 'M3' }, fresh)).toBe(false);
    expect(matchesAudience({ kind: 'participants' }, fresh)).toBe(true);
  });

  it('derives staff team membership from the arrays the catalogues already return', () => {
    const staff = staffReader({
      id: 'BT1',
      events: [
        event({ event_id: 'hackathon', event_team: [{ user_id: 'BT1', role: 'event_head' }] }),
        event({ event_id: 'robowars', event_team: [{ user_id: 'BT2', role: 'event_head' }] }),
      ],
      hostels: [
        {
          hostel_id: 'H12',
          name: 'Ganga',
          capacity: 300,
          gender: 'male',
          hostel_team: [{ user_id: 'BT1', role: 'other', logging: true }],
        } as Hostel,
      ],
      messHalls: [
        {
          mess_id: 'M3',
          name: 'Hall C',
          capacity: 500,
          preference: 'veg',
          mess_team: [{ user_id: 'BT9', role: 'other', logging: true }],
        } as Mess,
      ],
    });

    expect(staff.eventTeamIds).toEqual(['hackathon']);
    expect(staff.hostelTeamIds).toEqual(['H12']);
    expect(staff.messTeamIds).toEqual([]);
    expect(matchesAudience({ kind: 'hostel_team', id: 'H12' }, staff)).toBe(true);
    expect(matchesAudience({ kind: 'mess_team', id: 'M3' }, staff)).toBe(false);
  });
});

describe('expiry', () => {
  const now = new Date('2026-06-10T12:00:00.000Z');

  it('stands forever without an expiry', () => {
    expect(isLive(announcement(), now)).toBe(true);
  });

  it('stops at its expiry', () => {
    expect(isLive(announcement({ expiresAt: '2026-06-10T11:59:00.000Z' }), now)).toBe(false);
    expect(isLive(announcement({ expiresAt: '2026-06-10T12:01:00.000Z' }), now)).toBe(true);
  });

  it('treats an unparseable expiry as no expiry rather than un-sending the notice', () => {
    expect(isLive(announcement({ expiresAt: 'next tuesday' }), now)).toBe(true);
  });

  it('leaves an expired notice out of what a reader is shown', () => {
    const reader = participantReader({ id: 'DS23F1000042' });
    const shown = visibleTo(
      [
        announcement({ id: 'live' }),
        announcement({ id: 'gone', expiresAt: '2026-06-09T00:00:00.000Z' }),
      ],
      reader,
      now,
    );
    expect(shown.map((a) => a.id)).toEqual(['live']);
  });
});

describe('collecting the whole board', () => {
  it('reads notices off every event, because the carrier is storage not scope', () => {
    const events = [
      event({ event_id: 'a', registration: mapWith([stored({ id: 'AN-a' })]) }),
      event({ event_id: 'b', registration: mapWith([stored({ id: 'AN-b' })]) }),
      event({ event_id: 'c' }),
    ];
    expect(
      collectAnnouncements(events)
        .map((a) => a.id)
        .sort(),
    ).toEqual(['AN-a', 'AN-b']);
  });

  it('orders newest first', () => {
    const events = [
      event({
        event_id: 'a',
        registration: mapWith([
          stored({ id: 'old', posted_at: '2026-06-01T00:00:00.000Z' }),
          stored({ id: 'new', posted_at: '2026-06-09T00:00:00.000Z' }),
        ]),
      }),
    ];
    expect(collectAnnouncements(events).map((a) => a.id)).toEqual(['new', 'old']);
  });

  it('handles no events at all', () => {
    expect(collectAnnouncements(null)).toEqual([]);
    expect(collectAnnouncements([])).toEqual([]);
  });
});

describe('composing', () => {
  const now = new Date('2026-06-10T09:00:00.000Z');

  it('builds a notice with a stable, unique id', () => {
    const made = createAnnouncement(
      {
        title: '  Round 2 moved  ',
        body: '  Now at CLT.  ',
        audience: { kind: 'event', id: 'hackathon' },
        severity: 'urgent',
        postedBy: ' Ops Head ',
        carrierEventId: 'hackathon',
      },
      now,
      'abc123',
    );

    expect(made.id).toBe(`AN-${now.getTime().toString(36)}-abc123`);
    expect(made.title).toBe('Round 2 moved');
    expect(made.body).toBe('Now at CLT.');
    expect(made.postedBy).toBe('Ops Head');
    expect(made.postedAt).toBe('2026-06-10T09:00:00.000Z');
  });

  it('defaults to the quietest emphasis and no expiry', () => {
    const made = createAnnouncement(
      { title: 'T', body: 'B', audience: { kind: 'everyone' }, carrierEventId: 'hackathon' },
      now,
      'x',
    );
    expect(made.severity).toBe('info');
    expect(made.expiresAt).toBeUndefined();
  });

  it('refuses to send without a headline, a body, an audience, or somewhere to file it', () => {
    const ok = {
      title: 'T',
      body: 'B',
      audience: { kind: 'everyone' } as Audience,
      carrierEventId: 'hackathon',
    };
    expect(validateAnnouncement(ok)).toBeNull();
    expect(validateAnnouncement({ ...ok, title: '  ' })).toMatch(/headline/i);
    expect(validateAnnouncement({ ...ok, body: '' })).toMatch(/know/i);
    expect(validateAnnouncement({ ...ok, audience: null })).toMatch(/who/i);
    expect(validateAnnouncement({ ...ok, carrierEventId: '' })).toMatch(/event record/i);
  });
});
