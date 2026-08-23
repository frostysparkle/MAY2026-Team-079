/**
 * What a hall serves, when it serves it, and the edits its own team has made.
 *
 * ── Three layers, in order ──────────────────────────────────────────────────
 *  1. **The published sheet** (`festMenuData.ts`) — the campus menu for the
 *     hall's dietary category, transcribed for the six fest days. Never mutated.
 *  2. **The hall's stored menu** (`mess.menu`, written by `PUT /mess/{id}/menu`)
 *     — what its own team has actually set. Server-side, so it reaches everyone.
 *  3. **This device's copy** (`localStorage`) — the fallback for a hall that has
 *     no server menu yet, and the landing place for edits made before the route
 *     existed. Read only when layer 2 is absent; cleared once a save succeeds.
 *
 * `resolveMenu` folds the three into one answer, and "edited" is derived by
 * comparing the result against the published sheet rather than stored as a flag.
 * That means it reads correctly whether the stored menu is a full copy (which is
 * what the API holds) or a sparse diff (which is what this device holds) — and a
 * reset always lands back on the real published dish list.
 *
 * ── One thing the API models and this does not offer ────────────────────────
 * `MessMenuDay.slots` carries `start_time`/`end_time` per day, so a hall *could*
 * serve Tuesday's lunch at a different hour from Wednesday's. The editor writes
 * one window per sitting across every day, because that is what a mess actually
 * does — but the read path honours per-day windows if some other client writes
 * them, which is why `ResolvedDay` carries its own timings.
 */
import type { MealSlot, Mess, MessMenu, MessMenuRequest } from '@/api/types';
import { FEST_START_DATE } from '@/config/festCalendar';
import { MESS_SLOT_WINDOWS } from '@/config/messSlots';
import { messCuisineOf, messDietOf } from '@/config/constants';
import { FEST_MENU, type CategoryMenu, type MenuCategory, type MenuDay } from './festMenuData';

export type { MenuCategory, MenuDay, CategoryMenu };
export { FEST_MENU };

/** The three sittings, in the order they are served. */
export const MENU_SLOTS: readonly MealSlot[] = ['breakfast', 'lunch', 'dinner'];

export const SLOT_LABEL: Record<MealSlot, string> = {
  breakfast: 'Breakfast',
  lunch: 'Lunch',
  dinner: 'Dinner',
};

/** Fest days the menu covers — six, from the published schedule, not the five the swipe grid has. */
export const MENU_DAYS = FEST_MENU.south_veg.days.length;

/**
 * Which of the menu's days is today.
 *
 * Deliberately **not** `currentFestDay()`, which clamps to `FEST_DAYS` (5) because
 * that is how many days of `mess.entries` the backend seeds — correct for the
 * scanner, wrong here. The menu runs the schedule's full six days, so on 14 June
 * `currentFestDay()` says 5 and a participant would open on the previous day's
 * food. This clamps to the menu's own length instead.
 */
export function currentMenuDay(now: Date = new Date()): number {
  const diffMs = now.getTime() - FEST_START_DATE.getTime();
  const day = Math.floor(diffMs / (24 * 60 * 60 * 1000)) + 1;
  return Math.min(Math.max(day, 1), MENU_DAYS);
}

/* ------------------------------------------------------ hall → category --- */

/**
 * Which published menu a hall serves.
 *
 * Decided from the hall's single stored `type` (e.g. `"north_indian__veg"`,
 * `"jain"`) — the real backend field (`Mess.type`) — split into its cuisine and
 * diet axes with `messDietOf`/`messCuisineOf`. A hall declaring no region (only
 * `jain` has none) or, in principle, both gets the unified menu — that is
 * exactly what "unified" is for on the published sheets.
 *
 * `jain` maps to the no-onion-no-garlic sheet. It is the closest published menu,
 * not a certified Jain one, which is why `menuCaveat` says so out loud rather
 * than letting the mapping imply a guarantee the kitchen has not given.
 */
export function menuCategoryFor(type: string | undefined): MenuCategory {
  const value = (type ?? '').toLowerCase();
  if (value === 'jain') return 'north_veg_no_onion_garlic';

  const diet = messDietOf(value);
  const cuisine = messCuisineOf(value);
  const nonVeg = diet === 'non_veg';

  if (cuisine === 'south_indian') return nonVeg ? 'south_non_veg' : 'south_veg';
  if (cuisine === 'north_indian') return nonVeg ? 'north_non_veg' : 'north_veg';
  return nonVeg ? 'unified_non_veg' : 'unified_veg';
}

/** The one thing the mapping cannot promise, said plainly, or null when there is nothing to warn about. */
export function menuCaveat(type: string | undefined): string | null {
  return (type ?? '').toLowerCase() === 'jain'
    ? 'Jain halls are shown the no-onion-no-garlic menu, which is the closest sheet the campus kitchen publishes. Check with the hall for strict Jain requirements.'
    : null;
}

/* --------------------------------------------------------------- timing --- */

/** A service window as the editor stores and shows it: `HH:MM`, 24-hour. */
export interface SlotTiming {
  slot: MealSlot;
  start: string;
  end: string;
}

const hhmm = (hour: number) => `${String(hour).padStart(2, '0')}:00`;

/** The fest-wide windows from `config/messSlots.ts`, in the editor's shape. */
export const DEFAULT_TIMINGS: readonly SlotTiming[] = MESS_SLOT_WINDOWS.map((w) => ({
  slot: w.slot,
  start: hhmm(w.startHour),
  end: hhmm(w.endHour),
}));

/** `HH:MM` → minutes past midnight, or null if it is not a time. */
export function minutesOf(time: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

/** `07:00` → `7:00 am`. Left as typed if it is not a time, so a bad value is visible rather than silently blank. */
export function timeLabel(time: string): string {
  const total = minutesOf(time);
  if (total === null) return time;
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  const suffix = hours < 12 ? 'am' : 'pm';
  const display = hours % 12 === 0 ? 12 : hours % 12;
  return `${display}:${String(minutes).padStart(2, '0')} ${suffix}`;
}

/** "7:00 am – 9:00 am". */
export function timingLabel(timing: SlotTiming): string {
  return `${timeLabel(timing.start)} – ${timeLabel(timing.end)}`;
}

/**
 * Which sitting is open right now, against a specific hall's windows.
 *
 * This replaced `currentMessSlot()`, which read the fest-wide windows directly
 * and so could not be moved by a hall. Passing the windows in is what lets a hall
 * that has shifted its own breakfast have that shift honoured by its own scanner.
 * A window whose end is at or before its start is a typo, not an all-night
 * sitting, so it matches nothing rather than everything.
 */
export function slotAt(now: Date, timings: readonly SlotTiming[]): MealSlot | null {
  const minutes = now.getHours() * 60 + now.getMinutes();
  for (const timing of timings) {
    const start = minutesOf(timing.start);
    const end = minutesOf(timing.end);
    if (start === null || end === null || end <= start) continue;
    if (minutes >= start && minutes < end) return timing.slot;
  }
  return null;
}

/* ------------------------------------------------------------ overrides --- */

/** A hall's changes to the published menu. Absent keys mean "unchanged". */
export interface MenuOverride {
  /** Per-slot service windows for the whole hall, replacing the fest-wide defaults. */
  timings?: Partial<Record<MealSlot, { start: string; end: string }>>;
  /**
   * Per-day windows, keyed day then slot, taking precedence over `timings`.
   *
   * Only ever populated by reading a stored menu — the editor writes one window
   * per sitting across every day. It exists so a menu written by some other
   * client, using the per-day shape the API models, is read back faithfully
   * rather than flattened to whatever day 1 happened to say.
   */
  dayTimings?: Record<string, Partial<Record<MealSlot, { start: string; end: string }>>>;
  /** Dish lists keyed by fest day (1-based) then slot. */
  days?: Record<string, Partial<Record<MealSlot, string[]>>>;
  /** A free line the hall wants everyone eating there to read. */
  note?: string;
  updated_at?: string;
  /** Display name of whoever saved it, for the "last updated by" line. */
  updated_by?: string;
}

const STORAGE_KEY = 'pc_mess_menu_v1';

type OverrideStore = Record<string, MenuOverride>;

/** Storage may be unavailable (private mode, tests). Fail quietly, as the auth store does. */
function readStore(): OverrideStore {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    // A hand-edited or half-written value must not crash the screen it feeds.
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed as OverrideStore;
  } catch {
    return {};
  }
}

function writeStore(store: OverrideStore): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    /* ignore */
  }
}

export function readMenuOverride(messId: string): MenuOverride | null {
  const stored = readStore()[messId];
  return stored && typeof stored === 'object' ? stored : null;
}

/** Save a hall's override, stamped with the moment and the person. An empty override is removed rather than stored. */
export function saveMenuOverride(messId: string, override: MenuOverride, updatedBy?: string): void {
  const store = readStore();
  if (isEmptyOverride(override)) {
    delete store[messId];
  } else {
    store[messId] = {
      ...override,
      updated_at: new Date().toISOString(),
      ...(updatedBy ? { updated_by: updatedBy } : {}),
    };
  }
  writeStore(store);
}

/** Drop every change this hall has made, back to the published menu. */
export function clearMenuOverride(messId: string): void {
  const store = readStore();
  delete store[messId];
  writeStore(store);
}

function isEmptyOverride(override: MenuOverride): boolean {
  const hasTiming = Object.keys(override.timings ?? {}).length > 0;
  const hasDays = Object.values(override.days ?? {}).some(
    (day) => Object.keys(day ?? {}).length > 0,
  );
  return !hasTiming && !hasDays && !override.note?.trim();
}

/* -------------------------------------------------------------- resolve --- */

/** One fest day, after the hall's edits are laid over the published sheet. */
export interface ResolvedDay extends MenuDay {
  /** 1-based fest day, the same number `POST /mess/{id}/scan` takes. */
  day: number;
  /** Which of the three sittings this hall has rewritten. Derived, not stored. */
  edited: Record<MealSlot, boolean>;
  /** This day's service windows. Usually identical across days; see the file header. */
  timings: SlotTiming[];
}

export interface ResolvedMenu {
  category: MenuCategory;
  label: string;
  source: string;
  common: Record<MealSlot, string>;
  days: ResolvedDay[];
  /** The hall's windows — day 1's, which is every day's unless something wrote otherwise. */
  timings: SlotTiming[];
  note: string | null;
  caveat: string | null;
  /** True when the resolved menu differs from the published sheet in any way. */
  edited: boolean;
  updatedAt: string | null;
  updatedBy: string | null;
}

/**
 * The menu a hall actually serves: the published sheet for its category, with
 * this device's edits laid over it.
 *
 * `override` is passed in rather than read here so a screen that is editing can
 * render its unsaved draft through exactly the same code path the participant
 * view uses — there is then no second rendering of a menu that can disagree with
 * the first.
 */
export function resolveMenu(
  mess: Pick<Mess, 'type'> | null,
  override: MenuOverride | null,
): ResolvedMenu {
  const category = menuCategoryFor(mess?.type);
  const base = FEST_MENU[category];

  const days: ResolvedDay[] = base.days.map((published, index) => {
    const day = index + 1;
    const key = String(day);
    const dayOverride = override?.days?.[key] ?? {};
    const dayWindows = override?.dayTimings?.[key] ?? {};

    const edited = {} as Record<MealSlot, boolean>;
    const dishes = {} as Record<MealSlot, string[]>;
    const timings: SlotTiming[] = [];

    for (const fallback of DEFAULT_TIMINGS) {
      const slot = fallback.slot;
      const custom = dayOverride[slot];
      dishes[slot] = Array.isArray(custom) ? custom : published[slot];
      // Derived, not stored: a stored menu that happens to match the published
      // sheet is not an edit, and a sparse diff and a full copy read the same.
      edited[slot] = !sameDishes(dishes[slot], published[slot]);

      const custom_window = dayWindows[slot] ?? override?.timings?.[slot];
      timings.push(
        custom_window
          ? { slot, start: custom_window.start, end: custom_window.end }
          : { ...fallback },
      );
    }

    return { ...published, ...dishes, day, edited, timings };
  });

  const timings = days[0]?.timings ?? DEFAULT_TIMINGS.map((t) => ({ ...t }));
  const changedTimings = days.some((day) =>
    day.timings.some((timing) => {
      const fallback = DEFAULT_TIMINGS.find((t) => t.slot === timing.slot)!;
      return timing.start !== fallback.start || timing.end !== fallback.end;
    }),
  );
  const changedDays = days.some((day) => MENU_SLOTS.some((slot) => day.edited[slot]));

  return {
    category,
    label: base.label,
    source: base.source,
    common: base.common,
    days,
    timings,
    note: override?.note?.trim() || null,
    caveat: menuCaveat(mess?.type),
    edited: changedTimings || changedDays || Boolean(override?.note?.trim()),
    updatedAt: override?.updated_at ?? null,
    updatedBy: override?.updated_by ?? null,
  };
}

function sameDishes(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((dish, i) => dish === b[i]);
}

/* ------------------------------------------------------- server <-> local --- */

/**
 * The stored menu to lay over the published sheet: the hall's own from the
 * server when it has one, this device's copy when it does not.
 *
 * Server wins outright rather than merging. A merge would let a stale local copy
 * silently override what the hall's team actually published, which is the exact
 * failure the route was added to end.
 */
export function overrideFor(mess: Mess | null): MenuOverride | null {
  if (!mess) return null;
  return overrideFromMenu(mess.menu) ?? readMenuOverride(mess.mess_id);
}

/** `mess.menu` → the shape `resolveMenu` reads. Null when the hall has no menu stored. */
export function overrideFromMenu(menu: MessMenu | null | undefined): MenuOverride | null {
  if (!menu || (!menu.days?.length && !menu.note)) return null;

  const days: NonNullable<MenuOverride['days']> = {};
  const dayTimings: NonNullable<MenuOverride['dayTimings']> = {};

  for (const day of menu.days ?? []) {
    const key = String(day.day);
    for (const slot of day.slots ?? []) {
      // A slot the API does not scan for is not a sitting this app can show.
      if (!MENU_SLOTS.includes(slot.slot)) continue;
      if (Array.isArray(slot.dishes)) {
        days[key] = { ...(days[key] ?? {}), [slot.slot]: slot.dishes };
      }
      if (slot.start_time && slot.end_time) {
        dayTimings[key] = {
          ...(dayTimings[key] ?? {}),
          [slot.slot]: { start: slot.start_time, end: slot.end_time },
        };
      }
    }
  }

  return {
    days,
    dayTimings,
    note: menu.note ?? undefined,
    updated_at: menu.updated_at ?? undefined,
    updated_by: menu.updated_by ?? undefined,
  };
}

/**
 * A resolved menu → the body `PUT /mess/{id}/menu` takes.
 *
 * The whole menu goes up, not a diff: `menu` on a hall document should be the
 * hall's menu, readable on its own by anything that fetches it, rather than a
 * patch that only means something next to a copy of the published sheet.
 */
export function menuRequestFrom(menu: ResolvedMenu): MessMenuRequest {
  return {
    days: menu.days.map((day) => ({
      day: day.day,
      slots: day.timings.map((timing) => ({
        slot: timing.slot,
        start_time: timing.start,
        end_time: timing.end,
        dishes: day[timing.slot],
      })),
    })),
    note: menu.note,
  };
}

/* ----------------------------------------------------------- edit helpers --- */

/** Textarea text → dish list. Blank lines are dropped; they are how a list gets typed, not a dish. */
export function parseDishes(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

/** Dish list → textarea text. */
export function formatDishes(dishes: readonly string[]): string {
  return dishes.join('\n');
}

/** Put one slot's dishes into an override, or take them back out when they match the published sheet. */
export function withDishes(
  override: MenuOverride,
  day: number,
  slot: MealSlot,
  dishes: string[] | null,
): MenuOverride {
  const key = String(day);
  const days = { ...(override.days ?? {}) };
  const forDay = { ...(days[key] ?? {}) };

  if (dishes === null) delete forDay[slot];
  else forDay[slot] = dishes;

  if (Object.keys(forDay).length === 0) delete days[key];
  else days[key] = forDay;

  return { ...override, days };
}

/** Same, for a service window. `null` restores the fest-wide default. */
export function withTiming(
  override: MenuOverride,
  slot: MealSlot,
  window: { start: string; end: string } | null,
): MenuOverride {
  const timings = { ...(override.timings ?? {}) };
  if (window === null) delete timings[slot];
  else timings[slot] = window;
  return { ...override, timings };
}
