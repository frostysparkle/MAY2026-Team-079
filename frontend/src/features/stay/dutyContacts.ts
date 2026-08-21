import type {
  EmergencyContact,
  Hostel,
  HostelTeamMember,
  Mess,
  MessTeamMember,
  MyHostelResponse,
} from '@/api/types';

/**
 * The on-duty people a participant can actually reach — Story 5.3, and the
 * hand-off half of Story 5.4.
 *
 * `GET /hostels/my_hostel` already returns the block's team to its allotted
 * resident, deliberately narrowed by the backend to a name and a phone number:
 *
 * ```py
 * volunteers.append({"name": t.get("name") or t.get("role"),
 *                    "phone": t.get("phone", "N/A")})
 * ```
 *
 * `GET /mess/my_mess` returns the hall document whole, so its `mess_team`
 * carries the same two fields (plus a `user_id` and a scanning flag, which are
 * staff-facing and are not surfaced here).
 *
 * Both of those fallbacks leak through: a team member added without a name
 * arrives as the literal string `"volunteer"`, and one added without a phone
 * arrives as the literal string `"N/A"`. Rendering either as typed gives a
 * participant a contact card headed *volunteer* with *N/A* under it, which is
 * worse than showing nothing — so this module is where those become an honest
 * label and an honest absence, once, for every screen that lists contacts.
 */

/** One reachable person, as a screen should show them. */
export interface DutyContact {
  /** Never blank. Falls back to the caller's generic label for the role. */
  name: string;
  /** Dialable number as recorded, or `null` when the record has none. */
  phone: string | null;
}

/** What both team arrays and `my_hostel`'s masked list have in common. */
type ContactLike = {
  name?: string | null;
  phone?: string | null;
  role?: string | null;
};

/**
 * Values that mean "nobody filled this in". `"N/A"` is the backend's own
 * default for a team member stored without a phone, so it is the common case
 * rather than an edge one.
 */
const PLACEHOLDERS = new Set([
  'n/a',
  'na',
  'n.a.',
  'nil',
  'none',
  'null',
  'undefined',
  'tbd',
  'not available',
  '-',
  '--',
  'xxx',
]);

/**
 * The role words the backend substitutes for a missing name. They are storage
 * values, not something to print at a participant.
 */
const ROLE_WORDS = new Set(['volunteer', 'other', 'staff', 'team', 'coordinator']);

/**
 * A phone number as it should be shown, or `null` if there is nothing to dial.
 *
 * Kept as typed rather than reformatted: the fest's numbers are entered by
 * hand in several shapes (with and without `+91`, with and without spaces) and
 * imposing one on them would misrepresent a landline or an extension. The only
 * judgement made is whether enough digits are present to be a number at all —
 * four, so a short internal extension survives and `N/A` does not.
 */
export function normalisePhone(raw: string | null | undefined): string | null {
  const text = (raw ?? '').trim();
  if (!text || PLACEHOLDERS.has(text.toLowerCase())) return null;
  const digits = text.replace(/\D/g, '');
  return digits.length >= 4 ? text : null;
}

/** `tel:`/`sms:` want the number bare — digits and at most one leading `+`. */
export function dialDigits(phone: string): string {
  const plus = phone.trim().startsWith('+') ? '+' : '';
  return plus + phone.replace(/\D/g, '');
}

export function telHref(phone: string): string {
  return `tel:${dialDigits(phone)}`;
}

/**
 * An SMS to a number with the message already written.
 *
 * `?body=` is the form both iOS (16+) and Android honour. The text is
 * percent-encoded, newlines included, so a multi-line report survives the
 * hand-off to the messaging app.
 */
export function smsHref(phone: string, body: string): string {
  return `sms:${dialDigits(phone)}?body=${encodeURIComponent(body)}`;
}

/**
 * Team records → the contacts a screen can show.
 *
 * A record with neither a usable name nor a number is dropped: it would render
 * as a row saying "On-duty volunteer" and nothing else, which tells a
 * participant there is somebody but not how to reach them. Duplicates — the
 * same person on a block twice, which the team array permits — collapse.
 * Contacts with a number sort first, because a name alone cannot be acted on.
 */
export function readDutyContacts(
  entries: readonly ContactLike[] | null | undefined,
  fallbackName = 'On-duty volunteer',
): DutyContact[] {
  const seen = new Set<string>();
  const contacts: DutyContact[] = [];

  for (const entry of entries ?? []) {
    const named = (entry?.name ?? '').trim();
    const usable = named && !ROLE_WORDS.has(named.toLowerCase()) ? named : '';
    const phone = normalisePhone(entry?.phone);

    // Nothing to say and no way to reach them.
    if (!usable && !phone) continue;

    const contact: DutyContact = { name: usable || fallbackName, phone };
    const key = `${contact.name.toLowerCase()}|${phone ? dialDigits(phone) : ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    contacts.push(contact);
  }

  return [
    ...contacts.filter((contact) => contact.phone !== null),
    ...contacts.filter((contact) => contact.phone === null),
  ];
}

/** The block's on-duty team, from the participant's own `my_hostel` read. */
export function hostelContacts(hostel: MyHostelResponse | null | undefined): DutyContact[] {
  return readDutyContacts(hostel?.volunteers as HostelTeamMember[] | undefined, 'Hostel volunteer');
}

/** The hall's team, from the mess document `my_mess` returns whole. */
export function messContacts(team: readonly MessTeamMember[] | null | undefined): DutyContact[] {
  return readDutyContacts(team, 'Mess volunteer');
}

/** "3 contacts on duty" / "1 contact on duty" — the same wording everywhere. */
export function contactCountLabel(count: number): string {
  return `${count} contact${count === 1 ? '' : 's'} on duty`;
}

/* ----------------------------------------------------------- directory --- */

/**
 * The verified contact directory — Story 6.5.
 *
 * The story asks a participant to be able to look up emergency contacts:
 * hostel, mess, and event coordinators, not the next-of-kin they typed in about
 * themselves during profile completion. That directory already exists in the
 * API and simply had no screen:
 *
 * | Source | Route | Who may read it |
 * |---|---|---|
 * | `hostel.coordinator` + `hostel.hostel_team[]` | `GET /hostels` | any authenticated user |
 * | `mess.mess_team[]` | `GET /mess` | any authenticated user |
 * | the block's own duty list | `GET /hostels/my_hostel` | its allotted resident |
 *
 * So this is presentation over data the backend already publishes, not a new
 * domain. Nothing is widened to make it work: both catalogue routes return the
 * documents whole to every signed-in caller already.
 *
 * `profile.emergency_contact` is handled separately by `ownEmergencyContact`,
 * because it is the participant's *own* next-of-kin and belongs beside their
 * profile, not in a directory of people on duty.
 */

/** One place a participant can get help, and the people answering for it. */
export interface ContactGroup {
  /** Stable key — a `hostel_id` or `mess_id`. */
  id: string;
  /** What the place is called. */
  name: string;
  /** Which directory section it belongs to. */
  kind: 'hostel' | 'mess';
  /** Extra qualifier, e.g. "Men's block · 300 beds" or "veg · south indian". */
  detail?: string;
  /** The block's named coordinator, when one is recorded. Listed first. */
  coordinator: DutyContact | null;
  /** The on-duty team, coordinator excluded. */
  contacts: DutyContact[];
}

/**
 * `hostel.coordinator` is a bare `dict` on the backend — `HostelCreateRequest`
 * types it as one and nothing validates its keys — so it arrives here as
 * `Record<string, unknown>` and every field has to be proved rather than assumed.
 *
 * Seeded blocks carry a name and a phone; blocks created from the dashboard form
 * send whatever the admin typed, and blocks created before the field existed have
 * none at all. Anything that is not a usable string is treated as absent.
 */
export function coordinatorContact(
  coordinator: Record<string, unknown> | null | undefined,
): DutyContact | null {
  if (!coordinator || typeof coordinator !== 'object') return null;

  const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');
  // `name` is the documented key; the others are what hand-entered records use.
  const name = text(coordinator.name) || text(coordinator.full_name) || text(coordinator.contact);
  const phone = normalisePhone(text(coordinator.phone) || text(coordinator.mobile));

  if (!name && !phone) return null;
  return { name: name || 'Block coordinator', phone };
}

/** Deduplicate the coordinator out of the team list, so one person is one row. */
function excluding(contacts: DutyContact[], coordinator: DutyContact | null): DutyContact[] {
  if (!coordinator) return contacts;
  const key = `${coordinator.name.toLowerCase()}|${coordinator.phone ? dialDigits(coordinator.phone) : ''}`;
  return contacts.filter(
    (contact) =>
      `${contact.name.toLowerCase()}|${contact.phone ? dialDigits(contact.phone) : ''}` !== key,
  );
}

/**
 * Every hostel block as a directory entry.
 *
 * Blocks with nobody reachable are dropped: a card naming a block and offering no
 * way to contact it is a dead end that reads as a bug. `GET /hostels` is the
 * source, so this is the *whole* directory rather than only the caller's own
 * block — which is the point of a directory, and is why 5.3's my-block view
 * stays separate.
 */
export function hostelDirectory(hostels: readonly Hostel[] | null | undefined): ContactGroup[] {
  return (hostels ?? [])
    .map((hostel): ContactGroup => {
      const coordinator = coordinatorContact(hostel.coordinator);
      const team = readDutyContacts(hostel.hostel_team, 'Block volunteer');
      return {
        id: hostel.hostel_id,
        name: hostel.name,
        kind: 'hostel',
        detail: hostelDetail(hostel),
        coordinator,
        contacts: excluding(team, coordinator),
      };
    })
    .filter((group) => group.coordinator !== null || group.contacts.length > 0)
    .sort((a, b) => a.name.localeCompare(b.name));
}

function hostelDetail(hostel: Hostel): string | undefined {
  const parts = [hostel.category ?? hostel.gender, hostel.capacity ? `${hostel.capacity} beds` : '']
    .map((part) => (part ?? '').trim())
    .filter(Boolean);
  return parts.length > 0 ? parts.join(' · ') : undefined;
}

/** Every mess hall as a directory entry, on the same terms as the blocks. */
export function messDirectory(messHalls: readonly Mess[] | null | undefined): ContactGroup[] {
  return (messHalls ?? [])
    .map((hall): ContactGroup => {
      const parts = [hall.preference, ...(hall.cuisines ?? [])]
        .map((part) => (part ?? '').replace(/_/g, ' ').trim())
        .filter(Boolean);
      return {
        id: hall.mess_id,
        name: hall.name,
        kind: 'mess',
        detail: parts.length > 0 ? parts.join(' · ') : undefined,
        coordinator: null,
        contacts: readDutyContacts(hall.mess_team, 'Mess volunteer'),
      };
    })
    .filter((group) => group.contacts.length > 0)
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Narrow a directory by a typed query, matching the place *or* a person on it.
 *
 * Matching a person's name matters as much as matching the block: a participant
 * who was told "ask Meera" does not necessarily know which block Meera is on.
 * A group that matches by name keeps all its contacts; one that matches only
 * through a person is narrowed to the people who matched.
 */
export function searchDirectory(groups: readonly ContactGroup[], query: string): ContactGroup[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [...groups];

  return groups.flatMap((group): ContactGroup[] => {
    if (group.name.toLowerCase().includes(needle) || group.id.toLowerCase().includes(needle)) {
      return [group];
    }

    const coordinator = group.coordinator?.name.toLowerCase().includes(needle)
      ? group.coordinator
      : null;
    const contacts = group.contacts.filter((contact) =>
      contact.name.toLowerCase().includes(needle),
    );

    return coordinator || contacts.length > 0 ? [{ ...group, coordinator, contacts }] : [];
  });
}

/** How many reachable people a group lists, coordinator included. */
export function groupSize(group: ContactGroup): number {
  return group.contacts.length + (group.coordinator ? 1 : 0);
}

/**
 * The participant's own next-of-kin, as they entered it.
 *
 * Read from the session rather than an endpoint because there is none: no route
 * returns `profile.emergency_contact`, and the only place it is ever echoed back
 * is the `PATCH /profile/complete` response, which `authStore.updateParticipantProfile`
 * merges onto the session. So it is present after a profile save in this session
 * and absent on a fresh sign-in — hence the `null`, and hence the screen's prompt
 * to open Profile rather than a claim that nothing was recorded.
 */
export function ownEmergencyContact(
  emergency: EmergencyContact | null | undefined,
): (DutyContact & { relation?: string }) | null {
  const name = (emergency?.name ?? '').trim();
  const phone = normalisePhone(emergency?.phone);
  if (!name && !phone) return null;

  const relation = (emergency?.relation ?? '').trim().replace(/_/g, ' ');
  return {
    name: name || 'Emergency contact',
    phone,
    ...(relation ? { relation } : {}),
  };
}
