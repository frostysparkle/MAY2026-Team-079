import type { Event, RegistrationField } from '@/api/types';

/**
 * Several things the published festival catalogue shows have no dedicated column
 * on the backend `Event` schema: the rulebook URL, the FAQ list, the choice list
 * for a `select` registration field, the brochure's *display* strings, the
 * event's capacity, and the entry requirements a participant needs before they
 * reach the venue (reporting time, ID proof, allowed items, entry rules).
 *
 * The backend is frozen, so rather than change the schema they ride along in
 * `Event.registration` — a `Dict[str, str]` that the API stores and returns
 * verbatim, alongside its two known keys `start_time` and `end_time`. Extra
 * string keys pass through untouched.
 *
 * `registration` is also named in `PUBLIC_EVENT_FIELDS`, so every key below is
 * returned by `GET /events/public` as well as the authenticated list — which is
 * what lets one admin edit reach both the brochure and the in-app page.
 *
 * ## Why a display overlay exists
 *
 * The structured columns cannot express the brochure copy exactly:
 *
 *  - `prize_money.amount` is an `int`, but real prizes read "1 Plaque",
 *    "25 Plaques" and "₹10000 each".
 *  - A round's time reads "10 Jun, 03:30 pm" — not a timestamp, and often only
 *    a date ("1 Jun") with no time at all.
 *  - The meta tiles are curated: one event advertises 8 rounds while listing 4,
 *    another advertises 0 while listing 2, and one has no team-size or
 *    registration dates at all.
 *
 * So the columns stay authoritative for *behaviour* (registration windows, team
 * rules, round ordering) while the overlay below carries what the page *shows*.
 * When the overlay is absent — a plain event an admin just typed in — the view
 * layer derives everything from the columns exactly as before.
 *
 * Everything here is defensive on read: the map is free-form, so a hand-edited
 * or truncated value must degrade to "absent", never throw. A malformed FAQ
 * blob loses the FAQ section; it does not take the event page down.
 */

/** Keys the backend itself defines. Everything else in the map is ours. */
const RESERVED = ['start_time', 'end_time'] as const;

const RULEBOOK_KEY = 'rulebook';
const FAQS_KEY = 'faqs';
/** `options:team_size` holds the choice list for the `team_size` field. */
const OPTIONS_PREFIX = 'options:';
/** Ordered display meta tiles, overriding the ones derived from the columns. */
const META_KEY = 'meta';
/** Display prize amounts, positionally aligned with `prize_money`. */
const PRIZE_AMOUNTS_KEY = 'prize_amounts';
/** Display round times, positionally aligned with `schedule`. */
const ROUND_WHEN_KEY = 'round_when';
/** How many entries the event admits, as a decimal string. */
const CAPACITY_KEY = 'capacity';
/** When to report at the venue, e.g. "30 minutes before your round". */
const REPORTING_TIME_KEY = 'reporting_time';
/** The ID a participant must carry, e.g. "Institute ID card". */
const ID_PROOF_KEY = 'id_proof';
/** What participants may bring in, as a JSON array of strings. */
const ALLOWED_ITEMS_KEY = 'allowed_items';
/** Gate rules, as a JSON array of strings. */
const ENTRY_RULES_KEY = 'entry_rules';

export interface EventFaq {
  q: string;
  a: string;
}

/**
 * What a participant needs to know before turning up — Story 1.4. Grouped
 * because the event page renders them as one block and hides the block entirely
 * when an organiser has filled none of them in.
 */
export interface EventEntryInfo {
  reportingTime?: string;
  idProof?: string;
  allowedItems: string[];
  rules: string[];
}

/** Whether an organiser has filled in any entry requirement at all. */
export function hasEntryInfo(entry: EventEntryInfo): boolean {
  return Boolean(
    entry.reportingTime || entry.idProof || entry.allowedItems.length || entry.rules.length,
  );
}

/** One tile in the event page's meta grid, e.g. `Reg. Start` / `17 May`. */
export interface EventMetaRow {
  label: string;
  value: string;
}

export interface EventExtras {
  rulebook?: string;
  faqs: EventFaq[];
  /** field_id → choices, for `select` registration fields. */
  fieldOptions: Record<string, string[]>;
  /** Curated meta tiles. Empty means "derive them from the columns". */
  meta: EventMetaRow[];
  /**
   * Prize amounts as written, aligned with `prize_money` by index. A blank
   * entry means "format that prize's numeric amount instead".
   */
  prizeAmounts: string[];
  /**
   * Round times as written, aligned with `schedule` by index. A blank entry
   * means "format that round's start/end timestamps instead".
   */
  roundWhen: string[];
  /**
   * How many entries the event admits. Absent when the organiser has not set
   * one — which is the honest default, since the backend has no capacity column
   * and an unset limit must not read as a limit of zero.
   */
  capacity?: number;
  /** Entry requirements, always present as an object; may be entirely empty. */
  entry: EventEntryInfo;
}

/* ------------------------------------------------------------- reading --- */

function parseJsonArray(raw: string | undefined): unknown[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * A JSON array of free-text lines — entry rules, allowed items. Unlike
 * `parseStringArray` this *drops* blanks rather than preserving their position,
 * because nothing is aligned to these by index.
 */
function parseTextList(raw: string | undefined): string[] {
  return parseJsonArray(raw)
    .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
    .filter(Boolean);
}

/**
 * A positive whole number of seats, or `undefined`.
 *
 * Zero and negatives are rejected along with junk: the map is free-form, and a
 * stored `"0"` is far more likely to be a half-finished edit than a deliberate
 * "this event admits nobody". Reading it as absent keeps the page from
 * announcing a capacity the organiser never meant to publish.
 */
function parseCapacity(raw: string | undefined): number | undefined {
  if (!raw?.trim()) return undefined;
  const value = Number(raw.trim());
  return Number.isInteger(value) && value > 0 ? value : undefined;
}

/** Trimmed, or `undefined` when blank — never an empty string. */
function readText(raw: string | undefined): string | undefined {
  return raw?.trim() || undefined;
}

/** Pull our piggybacked fields out of an event's `registration` map. */
export function readEventExtras(registration: Event['registration'] | undefined): EventExtras {
  const map = (registration ?? {}) as Record<string, string | undefined>;

  const faqs = parseJsonArray(map[FAQS_KEY]).flatMap((entry): EventFaq[] => {
    if (typeof entry !== 'object' || entry === null) return [];
    const { q, a } = entry as { q?: unknown; a?: unknown };
    if (typeof q !== 'string' || typeof a !== 'string') return [];
    const question = q.trim();
    const answer = a.trim();
    return question && answer ? [{ q: question, a: answer }] : [];
  });

  const fieldOptions: Record<string, string[]> = {};
  for (const [key, value] of Object.entries(map)) {
    if (!key.startsWith(OPTIONS_PREFIX)) continue;
    const choices = parseTextList(value);
    if (choices.length > 0) fieldOptions[key.slice(OPTIONS_PREFIX.length)] = choices;
  }

  const meta = parseJsonArray(map[META_KEY]).flatMap((entry): EventMetaRow[] => {
    if (typeof entry !== 'object' || entry === null) return [];
    const { label, value } = entry as { label?: unknown; value?: unknown };
    if (typeof label !== 'string' || typeof value !== 'string') return [];
    const trimmed = label.trim();
    // A blank *value* is meaningful ("Rounds: 0" is not blank, but an empty
    // string would be); a blank label is not, since it labels nothing.
    return trimmed ? [{ label: trimmed, value: value.trim() }] : [];
  });

  return {
    rulebook: readText(map[RULEBOOK_KEY]),
    faqs,
    fieldOptions,
    meta,
    prizeAmounts: parseStringArray(map[PRIZE_AMOUNTS_KEY]),
    roundWhen: parseStringArray(map[ROUND_WHEN_KEY]),
    capacity: parseCapacity(map[CAPACITY_KEY]),
    entry: {
      reportingTime: readText(map[REPORTING_TIME_KEY]),
      idProof: readText(map[ID_PROOF_KEY]),
      allowedItems: parseTextList(map[ALLOWED_ITEMS_KEY]),
      rules: parseTextList(map[ENTRY_RULES_KEY]),
    },
  };
}

/**
 * A positionally-aligned list of display strings. Non-string entries collapse to
 * `''` rather than being dropped, because dropping one would shift every later
 * entry onto the wrong prize or round.
 */
function parseStringArray(raw: string | undefined): string[] {
  return parseJsonArray(raw).map((entry) => (typeof entry === 'string' ? entry.trim() : ''));
}

/** Choices for one `select` field, or an empty list if none were configured. */
export function optionsForField(extras: EventExtras, field: RegistrationField): string[] {
  return extras.fieldOptions[field.field_id] ?? [];
}

/* ------------------------------------------------------------- writing --- */

/**
 * Build the `registration` map to send to the API: the backend's own two keys
 * plus whichever extras are actually set. Empty values are omitted rather than
 * written as `""`, so the map never accumulates dead keys.
 */
export function writeEventRegistration(input: {
  startTime?: string;
  endTime?: string;
  rulebook?: string;
  faqs?: EventFaq[];
  fieldOptions?: Record<string, string[]>;
  meta?: EventMetaRow[];
  prizeAmounts?: string[];
  roundWhen?: string[];
  /** Ignored unless it is a positive whole number; see `parseCapacity`. */
  capacity?: number;
  entry?: Partial<EventEntryInfo>;
}): Record<string, string> {
  const map: Record<string, string> = {};

  if (input.startTime?.trim()) map.start_time = input.startTime.trim();
  if (input.endTime?.trim()) map.end_time = input.endTime.trim();

  if (input.rulebook?.trim()) map[RULEBOOK_KEY] = input.rulebook.trim();

  if (
    typeof input.capacity === 'number' &&
    Number.isInteger(input.capacity) &&
    input.capacity > 0
  ) {
    map[CAPACITY_KEY] = String(input.capacity);
  }

  const entry = input.entry ?? {};
  if (entry.reportingTime?.trim()) map[REPORTING_TIME_KEY] = entry.reportingTime.trim();
  if (entry.idProof?.trim()) map[ID_PROOF_KEY] = entry.idProof.trim();
  writeTextList(map, ALLOWED_ITEMS_KEY, entry.allowedItems);
  writeTextList(map, ENTRY_RULES_KEY, entry.rules);

  const faqs = (input.faqs ?? []).filter((f) => f.q.trim() && f.a.trim());
  if (faqs.length > 0) {
    map[FAQS_KEY] = JSON.stringify(faqs.map((f) => ({ q: f.q.trim(), a: f.a.trim() })));
  }

  for (const [fieldId, choices] of Object.entries(input.fieldOptions ?? {})) {
    writeTextList(map, `${OPTIONS_PREFIX}${fieldId}`, choices);
  }

  const meta = (input.meta ?? []).filter((m) => m.label.trim());
  if (meta.length > 0) {
    map[META_KEY] = JSON.stringify(
      meta.map((m) => ({ label: m.label.trim(), value: m.value.trim() })),
    );
  }

  writeAlignedList(map, PRIZE_AMOUNTS_KEY, input.prizeAmounts);
  writeAlignedList(map, ROUND_WHEN_KEY, input.roundWhen);

  return map;
}

/**
 * Write a free-text list, blanks dropped. Nothing is aligned to these by index,
 * so an empty row is just an empty row and is discarded rather than preserved.
 */
function writeTextList(
  map: Record<string, string>,
  key: string,
  values: string[] | undefined,
): void {
  const clean = (values ?? []).map((v) => v.trim()).filter(Boolean);
  if (clean.length > 0) map[key] = JSON.stringify(clean);
}

/**
 * Write a positionally-aligned display list, trailing blanks trimmed. Interior
 * blanks are kept — they hold the position of a prize or round that has no
 * override — but an all-blank list writes no key at all.
 */
function writeAlignedList(
  map: Record<string, string>,
  key: string,
  values: string[] | undefined,
): void {
  const clean = (values ?? []).map((v) => v.trim());
  while (clean.length > 0 && clean[clean.length - 1] === '') clean.pop();
  if (clean.length > 0) map[key] = JSON.stringify(clean);
}

/** The registration window, ignoring our piggybacked keys. */
export function readRegistrationWindow(registration: Event['registration'] | undefined): {
  startTime?: string;
  endTime?: string;
} {
  const map = (registration ?? {}) as Record<string, string | undefined>;
  return { startTime: map[RESERVED[0]], endTime: map[RESERVED[1]] };
}
