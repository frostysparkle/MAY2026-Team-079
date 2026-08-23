import { beforeEach, describe, expect, it } from 'vitest';
import type { MealSlot, MessMenu } from '@/api/types';
import { currentFestDay } from '@/config/festCalendar';
import { FEST_MENU } from './festMenuData';
import {
  DEFAULT_TIMINGS,
  MENU_DAYS,
  MENU_SLOTS,
  clearMenuOverride,
  currentMenuDay,
  formatDishes,
  menuCategoryFor,
  menuCaveat,
  menuRequestFrom,
  minutesOf,
  overrideFor,
  overrideFromMenu,
  parseDishes,
  readMenuOverride,
  resolveMenu,
  saveMenuOverride,
  slotAt,
  timeLabel,
  timingLabel,
  withDishes,
  withTiming,
  type MenuOverride,
} from './messMenu';

/** A minimal `Mess` stand-in carrying only the field `resolveMenu` reads. */
const hall = (type: string) => ({ type });

beforeEach(() => localStorage.clear());

describe('the published menu', () => {
  it('covers the six fest days, 9-14 June 2026, in every category', () => {
    expect(MENU_DAYS).toBe(6);
    for (const [name, category] of Object.entries(FEST_MENU)) {
      expect(
        category.days.map((d) => d.date),
        name,
      ).toEqual([
        '2026-06-09',
        '2026-06-10',
        '2026-06-11',
        '2026-06-12',
        '2026-06-13',
        '2026-06-14',
      ]);
    }
  });

  it('gives every day all three sittings and no empty one', () => {
    for (const [name, category] of Object.entries(FEST_MENU)) {
      for (const day of category.days) {
        for (const slot of MENU_SLOTS) {
          expect(day[slot].length, `${name} ${day.date} ${slot}`).toBeGreaterThan(0);
        }
      }
    }
  });

  it('carries no snacks sitting — a swipe could never be logged against one', () => {
    for (const category of Object.values(FEST_MENU)) {
      expect(Object.keys(category.common).sort()).toEqual(['breakfast', 'dinner', 'lunch']);
      expect(category.days[0]).not.toHaveProperty('snacks');
    }
  });

  it('strips the source’s emphasis marks from dish names', () => {
    const dishes = Object.values(FEST_MENU).flatMap((c) =>
      c.days.flatMap((d) => MENU_SLOTS.flatMap((s) => d[s])),
    );
    expect(dishes.some((d) => d.includes('*'))).toBe(false);
  });
});

describe('menuCategoryFor', () => {
  it('splits veg and non-veg by region for a hall whose type names one', () => {
    expect(menuCategoryFor('south_indian__veg')).toBe('south_veg');
    expect(menuCategoryFor('south_indian__non_veg')).toBe('south_non_veg');
    expect(menuCategoryFor('north_indian__veg')).toBe('north_veg');
    expect(menuCategoryFor('north_indian__non_veg')).toBe('north_non_veg');
  });

  it('falls to the unified sheet for a hall with no recognised region', () => {
    expect(menuCategoryFor(undefined)).toBe('unified_veg');
    expect(menuCategoryFor('')).toBe('unified_veg');
  });

  it('maps jain to the no-onion-no-garlic sheet', () => {
    expect(menuCategoryFor('jain')).toBe('north_veg_no_onion_garlic');
  });

  it('treats an unrecorded preference as veg rather than guessing non-veg', () => {
    expect(menuCategoryFor(undefined)).toBe('unified_veg');
    expect(menuCategoryFor('')).toBe('unified_veg');
  });

  it('says out loud that the jain mapping is an approximation', () => {
    expect(menuCaveat('jain')).toMatch(/closest sheet/);
    expect(menuCaveat('north_indian__veg')).toBeNull();
  });
});

describe('service windows', () => {
  it('defaults to the fest-wide windows from config', () => {
    expect(DEFAULT_TIMINGS).toEqual([
      { slot: 'breakfast', start: '07:00', end: '09:00' },
      { slot: 'lunch', start: '12:00', end: '14:00' },
      { slot: 'dinner', start: '19:00', end: '21:00' },
    ]);
  });

  it('parses and formats times, and refuses ones that are not times', () => {
    expect(minutesOf('07:30')).toBe(450);
    expect(minutesOf('24:00')).toBeNull();
    expect(minutesOf('7:60')).toBeNull();
    expect(minutesOf('lunchtime')).toBeNull();
    expect(timeLabel('07:05')).toBe('7:05 am');
    expect(timeLabel('12:00')).toBe('12:00 pm');
    expect(timeLabel('00:30')).toBe('12:30 am');
    // A bad value stays visible instead of rendering as a blank.
    expect(timeLabel('nope')).toBe('nope');
    expect(timingLabel({ slot: 'lunch', start: '12:00', end: '14:00' })).toBe('12:00 pm – 2:00 pm');
  });

  it('picks the open sitting, and none outside every window', () => {
    const at = (h: number, m = 0) => slotAt(new Date(2026, 5, 9, h, m), DEFAULT_TIMINGS);
    expect(at(7)).toBe('breakfast');
    expect(at(8, 59)).toBe('breakfast');
    // The window is half-open: the closing minute is closed.
    expect(at(9)).toBeNull();
    expect(at(13)).toBe('lunch');
    expect(at(20)).toBe('dinner');
    expect(at(22)).toBeNull();
  });

  it('ignores a window that ends at or before it starts rather than opening all night', () => {
    const broken = [{ slot: 'dinner' as const, start: '21:00', end: '19:00' }];
    expect(slotAt(new Date(2026, 5, 9, 22), broken)).toBeNull();
    expect(slotAt(new Date(2026, 5, 9, 20), broken)).toBeNull();
  });
});

describe('resolveMenu', () => {
  it('returns the published sheet untouched when nothing is overridden', () => {
    const menu = resolveMenu(hall('south_indian__veg'), null);
    expect(menu.category).toBe('south_veg');
    expect(menu.days[0].breakfast).toEqual(FEST_MENU.south_veg.days[0].breakfast);
    expect(menu.edited).toBe(false);
    expect(menu.days.every((d) => MENU_SLOTS.every((s) => !d.edited[s]))).toBe(true);
  });

  it('lays an override over one sitting and leaves the rest published', () => {
    const override: MenuOverride = { days: { '3': { dinner: ['Biryani', 'Raita'] } } };
    const menu = resolveMenu(hall('north_indian__veg'), override);

    expect(menu.days[2].dinner).toEqual(['Biryani', 'Raita']);
    expect(menu.days[2].edited.dinner).toBe(true);
    expect(menu.days[2].edited.lunch).toBe(false);
    expect(menu.days[1].dinner).toEqual(FEST_MENU.north_veg.days[1].dinner);
    expect(menu.edited).toBe(true);
  });

  it('never mutates the published transcription', () => {
    const before = [...FEST_MENU.unified_veg.days[0].lunch];
    resolveMenu(hall('veg'), { days: { '1': { lunch: ['Nothing'] } } });
    expect(FEST_MENU.unified_veg.days[0].lunch).toEqual(before);
  });

  it('replaces only the windows a hall has moved', () => {
    const menu = resolveMenu(hall('veg'), {
      timings: { breakfast: { start: '06:30', end: '09:30' } },
    });
    expect(menu.timings).toEqual([
      { slot: 'breakfast', start: '06:30', end: '09:30' },
      { slot: 'lunch', start: '12:00', end: '14:00' },
      { slot: 'dinner', start: '19:00', end: '21:00' },
    ]);
    expect(menu.edited).toBe(true);
  });

  it('surfaces a note only when it has something in it', () => {
    expect(resolveMenu(hall('veg'), { note: '  ' }).note).toBeNull();
    expect(resolveMenu(hall('veg'), { note: '  Late dinner  ' }).note).toBe('Late dinner');
    expect(resolveMenu(hall('veg'), { note: 'Late dinner' }).edited).toBe(true);
  });

  it('handles a hall that could not be read at all', () => {
    const menu = resolveMenu(null, null);
    expect(menu.category).toBe('unified_veg');
    expect(menu.days).toHaveLength(6);
  });
});

describe('edit helpers', () => {
  it('drops blank lines when parsing dishes, and round-trips', () => {
    expect(parseDishes('Idli\n\n  Vada  \n\n')).toEqual(['Idli', 'Vada']);
    expect(formatDishes(['Idli', 'Vada'])).toBe('Idli\nVada');
    expect(parseDishes(formatDishes(['Idli', 'Vada']))).toEqual(['Idli', 'Vada']);
  });

  it('resetting a sitting removes it from the override rather than blanking it', () => {
    let override = withDishes({}, 4, 'lunch', ['Pulao']);
    expect(override.days).toEqual({ '4': { lunch: ['Pulao'] } });

    override = withDishes(override, 4, 'lunch', null);
    // The day itself goes too — an empty day is not a day with no dishes.
    expect(override.days).toEqual({});
    expect(resolveMenu(hall('veg'), override).days[3].lunch).toEqual(
      FEST_MENU.unified_veg.days[3].lunch,
    );
  });

  it('resetting one sitting keeps the other sittings that day', () => {
    let override = withDishes({}, 2, 'lunch', ['Pulao']);
    override = withDishes(override, 2, 'dinner', ['Khichdi']);
    override = withDishes(override, 2, 'lunch', null);
    expect(override.days).toEqual({ '2': { dinner: ['Khichdi'] } });
  });

  it('resetting a window removes it', () => {
    let override = withTiming({}, 'dinner', { start: '19:30', end: '21:30' });
    expect(override.timings).toEqual({ dinner: { start: '19:30', end: '21:30' } });
    override = withTiming(override, 'dinner', null);
    expect(override.timings).toEqual({});
  });
});

describe('storage', () => {
  it('saves, reads back, and stamps who and when', () => {
    saveMenuOverride('MESS01', { note: 'Dinner is late' }, 'bt@paradox.in');
    const stored = readMenuOverride('MESS01');
    expect(stored?.note).toBe('Dinner is late');
    expect(stored?.updated_by).toBe('bt@paradox.in');
    expect(stored?.updated_at).toBeTruthy();
  });

  it('keeps halls apart', () => {
    saveMenuOverride('MESS01', { note: 'A' });
    saveMenuOverride('MESS02', { note: 'B' });
    expect(readMenuOverride('MESS01')?.note).toBe('A');
    expect(readMenuOverride('MESS02')?.note).toBe('B');
  });

  it('stores nothing for an override that changes nothing', () => {
    saveMenuOverride('MESS01', { days: {}, timings: {}, note: '   ' });
    expect(readMenuOverride('MESS01')).toBeNull();
  });

  it('removes a hall’s record once its last change is undone', () => {
    saveMenuOverride('MESS01', { note: 'A' });
    saveMenuOverride('MESS01', { note: '' });
    expect(readMenuOverride('MESS01')).toBeNull();
  });

  it('clears everything for one hall and leaves the others alone', () => {
    saveMenuOverride('MESS01', { note: 'A' });
    saveMenuOverride('MESS02', { note: 'B' });
    clearMenuOverride('MESS01');
    expect(readMenuOverride('MESS01')).toBeNull();
    expect(readMenuOverride('MESS02')?.note).toBe('B');
  });

  it('survives a hand-edited or half-written value instead of crashing the screen', () => {
    localStorage.setItem('pc_mess_menu_v1', '{ not json');
    expect(readMenuOverride('MESS01')).toBeNull();
    localStorage.setItem('pc_mess_menu_v1', '[1,2,3]');
    expect(readMenuOverride('MESS01')).toBeNull();
  });
});

/* ------------------------------------------------------- server <-> local --- */

/**
 * The layer added when `PUT /mess/{id}/menu` shipped. These are the tests that
 * matter most for story 4.1's write half: the whole point of the route is that an
 * edit leaves the device, so the conversion in both directions has to be exact,
 * and the server has to win when the two disagree.
 */

const serverMenu = (dishes: string[], start = '19:00', end = '21:00'): MessMenu => ({
  days: [{ day: 1, slots: [{ slot: 'dinner', start_time: start, end_time: end, dishes }] }],
  note: 'From the hall',
  updated_at: '2026-06-09T10:00:00Z',
  updated_by: 'BT1000000003',
});

describe('overrideFromMenu', () => {
  it('reads a stored menu into the shape resolveMenu layers', () => {
    const override = overrideFromMenu(serverMenu(['Biryani', 'Raita'], '19:30', '21:30'));
    expect(override?.days).toEqual({ '1': { dinner: ['Biryani', 'Raita'] } });
    expect(override?.dayTimings).toEqual({ '1': { dinner: { start: '19:30', end: '21:30' } } });
    expect(override?.note).toBe('From the hall');
    expect(override?.updated_by).toBe('BT1000000003');
  });

  it('treats a hall with no menu, or an empty one, as having nothing stored', () => {
    expect(overrideFromMenu(null)).toBeNull();
    expect(overrideFromMenu(undefined)).toBeNull();
    expect(overrideFromMenu({ days: [] })).toBeNull();
  });

  it('ignores a sitting this app cannot scan for', () => {
    // The API's `slot` is a free string; `snacks` would be a meal no swipe could
    // ever be logged against, so it is dropped rather than rendered.
    const override = overrideFromMenu({
      days: [
        {
          day: 1,
          slots: [
            { slot: 'snacks' as MealSlot, start_time: '16:00', end_time: '17:00', dishes: ['Tea'] },
            { slot: 'dinner', start_time: '19:00', end_time: '21:00', dishes: ['Biryani'] },
          ],
        },
      ],
    });
    expect(override?.days).toEqual({ '1': { dinner: ['Biryani'] } });
  });

  it('honours a per-day window, which the editor never writes but the API models', () => {
    const menu: MessMenu = {
      days: [
        {
          day: 1,
          slots: [{ slot: 'lunch', start_time: '12:00', end_time: '14:00', dishes: ['A'] }],
        },
        {
          day: 2,
          slots: [{ slot: 'lunch', start_time: '13:00', end_time: '15:00', dishes: ['B'] }],
        },
      ],
    };
    const resolved = resolveMenu(hall('veg'), overrideFromMenu(menu));
    expect(resolved.days[0].timings.find((t) => t.slot === 'lunch')?.start).toBe('12:00');
    expect(resolved.days[1].timings.find((t) => t.slot === 'lunch')?.start).toBe('13:00');
  });
});

describe('overrideFor', () => {
  const base = {
    mess_id: 'MESS01',
    name: 'Nilgiri',
    capacity: 400,
    type: 'south_indian__veg',
  };

  it('prefers the hall’s stored menu over a copy left on this device', () => {
    saveMenuOverride('MESS01', { days: { '1': { dinner: ['Stale'] } } });
    const override = overrideFor({ ...base, menu: serverMenu(['The truth']) });
    expect(override?.days).toEqual({ '1': { dinner: ['The truth'] } });
  });

  it('falls back to this device for a hall that has published nothing', () => {
    saveMenuOverride('MESS01', { days: { '1': { dinner: ['Device copy'] } } });
    expect(overrideFor(base)?.days).toEqual({ '1': { dinner: ['Device copy'] } });
  });

  it('is null when neither side has anything', () => {
    expect(overrideFor(base)).toBeNull();
    expect(overrideFor(null)).toBeNull();
  });
});

describe('menuRequestFrom', () => {
  it('sends the whole menu, not a diff', () => {
    const body = menuRequestFrom(resolveMenu(hall('south_indian__veg'), null));
    expect(body.days).toHaveLength(6);
    expect(body.days.map((d) => d.day)).toEqual([1, 2, 3, 4, 5, 6]);
    for (const day of body.days) {
      expect(day.slots.map((s) => s.slot)).toEqual(['breakfast', 'lunch', 'dinner']);
      // Every sitting travels with its window and its dishes, so the stored
      // document is readable on its own rather than only next to the published sheet.
      for (const slot of day.slots) {
        expect(slot.dishes.length).toBeGreaterThan(0);
        expect(slot.start_time).toMatch(/^\d{2}:\d{2}$/);
      }
    }
  });

  it('carries an edited sitting and an edited window', () => {
    let override = withDishes({}, 2, 'dinner', ['Biryani']);
    override = withTiming(override, 'dinner', { start: '19:30', end: '21:30' });
    const body = menuRequestFrom(resolveMenu(hall('veg'), override));

    const dayTwo = body.days.find((d) => d.day === 2)!;
    expect(dayTwo.slots.find((s) => s.slot === 'dinner')?.dishes).toEqual(['Biryani']);
    // A window set on the hall applies to every day.
    expect(
      body.days.every((d) => d.slots.find((s) => s.slot === 'dinner')!.start_time === '19:30'),
    ).toBe(true);
  });

  it('round-trips: publishing then reading back leaves the same menu', () => {
    const original = resolveMenu(hall('north_indian__veg'), {
      days: { '3': { lunch: ['Rajma', 'Chawal'] } },
      note: 'Late lunch',
    });
    const readBack = resolveMenu(
      hall('north_indian__veg'),
      overrideFromMenu({ ...menuRequestFrom(original), note: original.note }),
    );

    expect(readBack.days.map((d) => d.lunch)).toEqual(original.days.map((d) => d.lunch));
    expect(readBack.days.map((d) => d.dinner)).toEqual(original.days.map((d) => d.dinner));
    expect(readBack.note).toBe('Late lunch');
    expect(readBack.timings).toEqual(original.timings);
  });
});

describe('“edited” is derived, not stored', () => {
  it('does not call a stored menu edited when it matches the published sheet', () => {
    // This is why the flag is derived: the API holds a full copy of the menu, so a
    // stored-equals-published hall would otherwise report every sitting as changed.
    const published = resolveMenu(hall('south_indian__veg'), null);
    const stored = overrideFromMenu({ ...menuRequestFrom(published), note: null });
    const resolved = resolveMenu(hall('south_indian__veg'), stored);

    expect(resolved.edited).toBe(false);
    expect(resolved.days.every((d) => MENU_SLOTS.every((s) => !d.edited[s]))).toBe(true);
  });

  it('flags exactly the sitting that differs from the published sheet', () => {
    const published = resolveMenu(hall('south_indian__veg'), null);
    const body = menuRequestFrom(published);
    body.days[0].slots[2].dishes = ['Something else'];

    const resolved = resolveMenu(hall('south_indian__veg'), overrideFromMenu(body));
    expect(resolved.days[0].edited.dinner).toBe(true);
    expect(resolved.days[0].edited.breakfast).toBe(false);
    expect(resolved.days[1].edited.dinner).toBe(false);
    expect(resolved.edited).toBe(true);
  });

  it('reports a reordered dish list as edited — order is what is served first', () => {
    const published = FEST_MENU.unified_veg.days[0].lunch;
    const resolved = resolveMenu(hall('veg'), {
      days: { '1': { lunch: [...published].reverse() } },
    });
    expect(resolved.days[0].edited.lunch).toBe(true);
  });
});

describe('currentMenuDay', () => {
  /**
   * Regression. The menu board was originally opened on `currentFestDay()`, which
   * clamps to `FEST_DAYS` (5) because that is how many days of `mess.entries` the
   * backend seeds. The menu runs the schedule's full six days, so on 14 June — the
   * last day of the fest — a participant opened on the *previous* day's food.
   */
  it('reaches day 6, where currentFestDay stops at 5', () => {
    expect(currentMenuDay(new Date('2026-06-14T12:00:00'))).toBe(6);
    expect(currentFestDay(new Date('2026-06-14T12:00:00'))).toBe(5);
  });

  it('tracks each fest day in turn', () => {
    const days = ['09', '10', '11', '12', '13', '14'].map((d) =>
      currentMenuDay(new Date(`2026-06-${d}T12:00:00`)),
    );
    expect(days).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('clamps outside the fest rather than returning a day the menu has no entry for', () => {
    expect(currentMenuDay(new Date('2026-01-01T12:00:00'))).toBe(1);
    expect(currentMenuDay(new Date('2026-08-20T12:00:00'))).toBe(MENU_DAYS);
  });

  it('never points past the menu it indexes', () => {
    for (const iso of ['2026-06-08', '2026-06-14', '2026-06-30', '2027-01-01']) {
      const day = currentMenuDay(new Date(`${iso}T12:00:00`));
      expect(resolveMenu(hall('veg'), null).days.some((d) => d.day === day)).toBe(true);
    }
  });
});
