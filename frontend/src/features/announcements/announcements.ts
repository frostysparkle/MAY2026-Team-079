import type { Event, Hostel, Mess, MyEventRegistration } from '@/api/types';
import { ANNOUNCEMENTS_KEY, readEventExtras } from '@/features/events/eventExtras';

/**
 * Official announcements, and who each one is for — Stories 8.1 and 8.2.
 *
 * ## Where an announcement lives
 *
 * The backend has no announcements collection, no notification domain, and no
 * send route. What it does have is `Event.registration` — a `Dict[str, str]`
 * that `PUT /events/{event_id}` stores verbatim and `GET /events` returns
 * verbatim, with arbitrary extra keys passing through untouched. Stories 1.3 and
 * 1.4 already carry the rulebook, FAQs, capacity, and entry requirements there;
 * see `features/events/eventExtras.ts` for the mechanism and why it exists.
 *
 * An announcement is a JSON array under one more key. That makes it *genuinely
 * server-side*, unlike the device-local records in `features/events/eventChanges.ts`
 * or `features/mess/messMenu.ts`: one Super Admin writes it once, and every other
 * signed-in user reads the same row back from the API on their own device. That is
 * the difference between a delivery channel and a note to self, and it is why
 * this story ships where a query system cannot.
 *
 * ## Why the carrier is an event, and why that does not restrict the audience
 *
 * `GET /events` returns *every* event to *any* authenticated user. So a notice
 * filed on one event is readable by everybody, whether or not they have anything
 * to do with that event. The carrier is therefore storage, not scope: the
 * audience below decides who is shown a notice, entirely independently of which
 * event's map happens to hold it.
 *
 * ## The honest limitation
 *
 * `registration` is named in `PUBLIC_EVENT_FIELDS`, so `GET /events/public`
 * returns it to anonymous visitors. **An announcement stored this way is a
 * public notice.** Targeting decides who it is *shown* to, not who is *able* to
 * fetch it. That is the right shape for what Story 8.1 asks for — official
 * announcements, of the "Round 2 has moved to CLT" kind — and the wrong shape
 * for anything confidential. The composer says so on screen rather than letting
 * an audience selector imply privacy it cannot provide. A private channel needs
 * a collection with a read guard, which is backend work.
 *
 * Delivery is also on next open rather than pushed, for the same reason Story
 * 1.2's alerts are: there is nothing to subscribe to and nothing that can push.
 */

/* ------------------------------------------------------------- audience --- */

/**
 * Who a notice is for.
 *
 * Every arm is resolvable on the reader's own device from data it already holds —
 * their registrations, their house, their allotted block and hall, or the team
 * arrays that `GET /events`, `GET /hostels`, and `GET /mess` return. Nothing here
 * needs a route that does not exist, which is what makes Story 8.2's "affected
 * participants only" answerable at all.
 */
export type Audience =
  /** Everyone signed in, participant or staff. */
  | { kind: 'everyone' }
  /** Every participant, no staff. */
  | { kind: 'participants' }
  /** Every staff member, no participants. */
  | { kind: 'staff' }
  /** Participants holding a registration for this event — Story 8.2's core case. */
  | { kind: 'event'; id: string }
  /** Participants in one house. */
  | { kind: 'house'; id: string }
  /** Participants allotted a bed in one block. */
  | { kind: 'hostel'; id: string }
  /** Participants allotted one mess hall. */
  | { kind: 'mess'; id: string }
  /** Staff named on one event's `event_team`. */
  | { kind: 'event_team'; id: string }
  /** Staff named on one block's `hostel_team`. */
  | { kind: 'hostel_team'; id: string }
  /** Staff named on one hall's `mess_team`. */
  | { kind: 'mess_team'; id: string };

/** Arms that carry no id, so a stray `:suffix` on one is malformed rather than ignored. */
const GLOBAL_KINDS = ['everyone', 'participants', 'staff'] as const;

/** Arms that require an id. An empty id addresses nothing, so it is rejected. */
const SCOPED_KINDS = [
  'event',
  'house',
  'hostel',
  'mess',
  'event_team',
  'hostel_team',
  'mess_team',
] as const;

type GlobalKind = (typeof GLOBAL_KINDS)[number];
type ScopedKind = (typeof SCOPED_KINDS)[number];

/**
 * `everyone`, or `house:Nilgiri` — one string, because the whole record has to
 * survive as a value inside a `Dict[str, str]`.
 */
export function encodeAudience(audience: Audience): string {
  return 'id' in audience ? `${audience.kind}:${audience.id}` : audience.kind;
}

/**
 * The inverse, or `null` when the text is not an audience this build knows.
 *
 * `null` rather than a default: silently reading an unrecognised selector as
 * "everyone" would broadcast a notice that was addressed to one block, and
 * reading it as "nobody" at least fails in the direction that discloses less.
 * The notice is dropped by `readAnnouncements`, not shown to the wrong people.
 */
export function parseAudience(raw: string | undefined | null): Audience | null {
  const text = (raw ?? '').trim();
  if (!text) return null;

  const separator = text.indexOf(':');
  if (separator === -1) {
    return (GLOBAL_KINDS as readonly string[]).includes(text)
      ? ({ kind: text as GlobalKind } as Audience)
      : null;
  }

  const kind = text.slice(0, separator);
  const id = text.slice(separator + 1).trim();
  if (!id) return null;
  return (SCOPED_KINDS as readonly string[]).includes(kind)
    ? ({ kind: kind as ScopedKind, id } as Audience)
    : null;
}

/**
 * How an audience reads on screen, for the sender's confirmation and for the
 * "who else got this" line on the notice itself.
 *
 * `names` maps an id to something a person recognises — an event's name rather
 * than its `event_id`. An id with no entry prints as itself, which is honest
 * about an event that has since been deleted.
 */
export function audienceLabel(audience: Audience, names: Record<string, string> = {}): string {
  const named = 'id' in audience ? names[audience.id] || audience.id : '';
  switch (audience.kind) {
    case 'everyone':
      return 'Everyone';
    case 'participants':
      return 'All participants';
    case 'staff':
      return 'All staff';
    case 'event':
      return `Registered for ${named}`;
    case 'house':
      // The stored values already end in "House" (`config/houses.ts`), so the
      // suffix is dropped to avoid printing "House Nilgiri House".
      return `House ${named.replace(/\s+House$/i, '')}`;
    case 'hostel':
      return `Residents of ${named}`;
    case 'mess':
      return `Diners at ${named}`;
    case 'event_team':
      return `${named} event team`;
    case 'hostel_team':
      return `${named} block team`;
    case 'mess_team':
      return `${named} mess team`;
  }
}

/* --------------------------------------------------------------- record --- */

export type AnnouncementSeverity = 'info' | 'important' | 'urgent';

const SEVERITIES: readonly AnnouncementSeverity[] = ['info', 'important', 'urgent'];

/** One notice, as the app works with it. */
export interface Announcement {
  id: string;
  title: string;
  body: string;
  audience: Audience;
  severity: AnnouncementSeverity;
  /** ISO 8601, in UTC. */
  postedAt: string;
  /** The sender's `paradox_id`, or their designation when one was recorded. */
  postedBy?: string;
  /** ISO 8601. Absent means it stands until it is deleted. */
  expiresAt?: string;
  /**
   * Which event's `registration` map holds this row. Storage, not scope — see
   * the module header. Needed so an edit or a delete can find its way back to
   * the right `PUT /events/{event_id}`.
   */
  carrierEventId: string;
}

/**
 * The stored shape. Snake-cased because it is wire data sitting in a Mongo
 * document, matching how `api/types.ts` mirrors the rest of the API rather than
 * translating it.
 */
interface StoredAnnouncement {
  id: string;
  title: string;
  body: string;
  audience: string;
  severity: string;
  posted_at: string;
  posted_by?: string;
  expires_at?: string;
}

/**
 * How many notices one event's map will hold.
 *
 * The whole array has to fit in a single Mongo string value alongside the rest
 * of the registration map, and a page that renders four hundred notices is not
 * a page anybody reads. Writing past the cap drops the oldest, so the newest
 * notice always lands.
 */
export const MAX_ANNOUNCEMENTS_PER_EVENT = 40;

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function readSeverity(value: unknown): AnnouncementSeverity {
  const text = readString(value).toLowerCase() as AnnouncementSeverity;
  // An unknown severity reads as `info`. Severity is emphasis, not access, so
  // the safe failure is the quiet one — the notice still gets delivered.
  return SEVERITIES.includes(text) ? text : 'info';
}

/**
 * Parse the notices out of one event's registration map.
 *
 * Defensive throughout, for the reason the whole overlay is: the map is
 * free-form, so a truncated or hand-edited value must lose the notice, never the
 * screen. A row missing a title, a body, a parseable audience, or a posted-at
 * timestamp is dropped rather than rendered half-blank.
 */
export function readAnnouncements(
  registration: Event['registration'] | undefined,
  carrierEventId: string,
): Announcement[] {
  const raw = readEventExtras(registration).announcementsRaw;
  if (!raw) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const seen = new Set<string>();
  return parsed.flatMap((entry): Announcement[] => {
    if (typeof entry !== 'object' || entry === null) return [];
    const row = entry as Partial<StoredAnnouncement>;

    const id = readString(row.id);
    const title = readString(row.title);
    const body = readString(row.body);
    const postedAt = readString(row.posted_at);
    const audience = parseAudience(row.audience);

    if (!id || !title || !body || !postedAt || !audience) return [];
    // A duplicated id would give two notices the same dismissal key, so the
    // second would vanish the moment the first was dismissed.
    if (seen.has(id)) return [];
    seen.add(id);

    const postedBy = readString(row.posted_by);
    const expiresAt = readString(row.expires_at);

    return [
      {
        id,
        title,
        body,
        audience,
        severity: readSeverity(row.severity),
        postedAt,
        ...(postedBy ? { postedBy } : {}),
        ...(expiresAt ? { expiresAt } : {}),
        carrierEventId,
      },
    ];
  });
}

/**
 * Serialise notices back to the single string the map holds, or `undefined` when
 * there are none — so an emptied list removes the key rather than leaving `"[]"`
 * behind, matching how `eventExtras` refuses to write dead keys.
 */
export function writeAnnouncementsValue(
  announcements: readonly Announcement[],
): string | undefined {
  if (announcements.length === 0) return undefined;

  const rows: StoredAnnouncement[] = newestFirst(announcements)
    .slice(0, MAX_ANNOUNCEMENTS_PER_EVENT)
    .map((a) => ({
      id: a.id,
      title: a.title.trim(),
      body: a.body.trim(),
      audience: encodeAudience(a.audience),
      severity: a.severity,
      posted_at: a.postedAt,
      ...(a.postedBy?.trim() ? { posted_by: a.postedBy.trim() } : {}),
      ...(a.expiresAt?.trim() ? { expires_at: a.expiresAt.trim() } : {}),
    }));

  return JSON.stringify(rows);
}

/**
 * The registration map to send to `PUT /events/{event_id}`, with the notices
 * replaced and **every other key preserved exactly as it arrived**.
 *
 * Deliberately a shallow copy of the stored map rather than a rebuild through
 * `writeEventRegistration`: the composer has no business normalising an event's
 * FAQs or capacity on its way past, and `update_event` only `$set`s the fields a
 * request actually carries, so sending `{ registration }` alone leaves the rest
 * of the event untouched.
 */
export function registrationWithAnnouncements(
  registration: Event['registration'] | undefined,
  announcements: readonly Announcement[],
): Record<string, string> {
  const map: Record<string, string> = { ...((registration ?? {}) as Record<string, string>) };
  const value = writeAnnouncementsValue(announcements);
  if (value) {
    map[ANNOUNCEMENTS_KEY] = value;
  } else {
    delete map[ANNOUNCEMENTS_KEY];
  }
  return map;
}

/* --------------------------------------------------------------- reading --- */

/** Newest first, by posted-at. Ties keep their relative order. */
export function newestFirst(announcements: readonly Announcement[]): Announcement[] {
  return [...announcements].sort((a, b) => b.postedAt.localeCompare(a.postedAt));
}

/**
 * Every notice on the board, from every event's map.
 *
 * The carrier is storage, so all of them are read regardless of which event they
 * happen to sit on; `visibleTo` is what decides who sees what.
 */
export function collectAnnouncements(events: readonly Event[] | null | undefined): Announcement[] {
  return newestFirst(
    (events ?? []).flatMap((event) => readAnnouncements(event.registration, event.event_id)),
  );
}

/** Whether a notice is still standing at `now`. */
export function isLive(announcement: Announcement, now: Date = new Date()): boolean {
  if (!announcement.expiresAt) return true;
  const expiry = Date.parse(announcement.expiresAt);
  // An unparseable expiry is treated as no expiry: dropping a notice because of
  // a malformed date would silently un-send it.
  return Number.isNaN(expiry) ? true : expiry > now.getTime();
}

/**
 * Who is reading, in the terms the audience arms are written in.
 *
 * Assembled by the caller from what it already fetched, so this module stays
 * pure and every rule below is testable without a network or a clock.
 */
export interface AnnouncementReader {
  kind: 'participant' | 'staff';
  /** `participant_id` or `paradox_id`. */
  id: string;
  /** `profile.house`. Free text on the backend, so compared case-insensitively. */
  house?: string | null;
  /** `event_id`s this participant holds a registration for. */
  registeredEventIds?: readonly string[];
  /** `assigned_hostel` from `GET /hostels/my_hostel`. */
  hostelId?: string | null;
  /** `allotted_mess` from `GET /mess/my_mess`. */
  messId?: string | null;
  /** `event_id`s whose `event_team` names this staff member. */
  eventTeamIds?: readonly string[];
  /** `hostel_id`s whose `hostel_team` names them. */
  hostelTeamIds?: readonly string[];
  /** `mess_id`s whose `mess_team` names them. */
  messTeamIds?: readonly string[];
}

function includesId(ids: readonly string[] | undefined, id: string): boolean {
  return (ids ?? []).includes(id);
}

function sameText(a: string | null | undefined, b: string): boolean {
  return (a ?? '').trim().toLowerCase() === b.trim().toLowerCase();
}

/**
 * Whether this reader is one of the people a notice was addressed to.
 *
 * A participant never matches a staff-team arm and a staff member never matches
 * a participant arm, even when the same person holds both accounts: the two
 * sessions carry different ids from different collections, and a volunteer
 * reading their duty board is not asking what their own registrations were told.
 */
export function matchesAudience(audience: Audience, reader: AnnouncementReader): boolean {
  switch (audience.kind) {
    case 'everyone':
      return true;
    case 'participants':
      return reader.kind === 'participant';
    case 'staff':
      return reader.kind === 'staff';
    case 'event':
      return reader.kind === 'participant' && includesId(reader.registeredEventIds, audience.id);
    case 'house':
      return reader.kind === 'participant' && sameText(reader.house, audience.id);
    case 'hostel':
      return reader.kind === 'participant' && sameText(reader.hostelId, audience.id);
    case 'mess':
      return reader.kind === 'participant' && sameText(reader.messId, audience.id);
    case 'event_team':
      return reader.kind === 'staff' && includesId(reader.eventTeamIds, audience.id);
    case 'hostel_team':
      return reader.kind === 'staff' && includesId(reader.hostelTeamIds, audience.id);
    case 'mess_team':
      return reader.kind === 'staff' && includesId(reader.messTeamIds, audience.id);
  }
}

/** The notices this reader should be shown: addressed to them, and not expired. */
export function visibleTo(
  announcements: readonly Announcement[],
  reader: AnnouncementReader,
  now: Date = new Date(),
): Announcement[] {
  return newestFirst(
    announcements.filter((a) => isLive(a, now) && matchesAudience(a.audience, reader)),
  );
}

/* --------------------------------------------------------------- readers --- */

/** A participant's reader context, from the calls their screens already make. */
export function participantReader(input: {
  id: string;
  house?: string | null;
  registrations?: readonly MyEventRegistration[] | null;
  hostelId?: string | null;
  messId?: string | null;
}): AnnouncementReader {
  return {
    kind: 'participant',
    id: input.id,
    house: input.house ?? null,
    registeredEventIds: (input.registrations ?? []).map((r) => r.event_id),
    hostelId: input.hostelId ?? null,
    messId: input.messId ?? null,
  };
}

/**
 * A staff member's reader context, derived from the team arrays the catalogue
 * endpoints already return.
 *
 * `GET /events` carries `event_team` for any authenticated caller, and
 * `GET /hostels` / `GET /mess` carry their team arrays whole, so no extra
 * request is needed to work out which teams name this person.
 */
export function staffReader(input: {
  id: string;
  events?: readonly Event[] | null;
  hostels?: readonly Hostel[] | null;
  messHalls?: readonly Mess[] | null;
}): AnnouncementReader {
  const id = input.id;
  return {
    kind: 'staff',
    id,
    eventTeamIds: (input.events ?? [])
      .filter((event) => (event.event_team ?? []).some((m) => m.user_id === id))
      .map((event) => event.event_id),
    hostelTeamIds: (input.hostels ?? [])
      .filter((hostel) => (hostel.hostel_team ?? []).some((m) => m.user_id === id))
      .map((hostel) => hostel.hostel_id),
    messTeamIds: (input.messHalls ?? [])
      .filter((hall) => (hall.mess_team ?? []).some((m) => m.user_id === id))
      .map((hall) => hall.mess_id),
  };
}

/* -------------------------------------------------------------- composing --- */

/**
 * A new notice, ready to be written.
 *
 * `nonce` is taken rather than generated so a test can pin the id. Ids have to
 * be stable across reloads — a dismissal is stored against one — and unique
 * within an event's array, which a timestamp alone is not when two notices are
 * sent in the same millisecond.
 */
export function createAnnouncement(
  input: {
    title: string;
    body: string;
    audience: Audience;
    severity?: AnnouncementSeverity;
    postedBy?: string;
    expiresAt?: string;
    carrierEventId: string;
  },
  now: Date = new Date(),
  nonce: string = Math.random().toString(36).slice(2, 8),
): Announcement {
  return {
    id: `AN-${now.getTime().toString(36)}-${nonce}`,
    title: input.title.trim(),
    body: input.body.trim(),
    audience: input.audience,
    severity: input.severity ?? 'info',
    postedAt: now.toISOString(),
    ...(input.postedBy?.trim() ? { postedBy: input.postedBy.trim() } : {}),
    ...(input.expiresAt?.trim() ? { expiresAt: input.expiresAt.trim() } : {}),
    carrierEventId: input.carrierEventId,
  };
}

/** Why a notice cannot be sent yet, or `null` when it can. */
export function validateAnnouncement(input: {
  title: string;
  body: string;
  audience: Audience | null;
  carrierEventId: string;
}): string | null {
  if (!input.title.trim()) return 'Give the announcement a headline.';
  if (!input.body.trim()) return 'Write what you need people to know.';
  if (!input.audience) return 'Choose who this announcement is for.';
  if (!input.carrierEventId) return 'Choose which event record to file this announcement on.';
  return null;
}
