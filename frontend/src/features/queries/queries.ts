import type {
  Event,
  Hostel,
  Mess,
  MyEventRegistration,
  MyHostelResponse,
  MyMessResponse,
  MyWorkshopRegistration,
  QueryCategory,
  QueryCreateRequest,
  QueryRecord,
  QueryReply,
  QueryStatus,
  Workshop,
} from '@/api/types';
import type { BadgeTone } from '@/components/ui';

/**
 * Asking a question and getting an answer — Epic 6, the pure half.
 *
 * A *query* is not an *issue*. Story 5.4's `/issues` domain records a fault in a
 * facility somebody is placed in: it has a room number, a repair, and a
 * placement check that refuses a report about a block you do not live in. A
 * query is a question about anything at the fest — an event's rules, a
 * workshop's prerequisites, a hall's timings, or nothing in particular — and its
 * answer is a sentence rather than a plumber. The two ship as separate domains
 * because their guards genuinely differ, and this module deliberately borrows
 * `features/issues/issues.ts`'s shape so a reader who knows one knows the other.
 *
 * Every rule below mirrors one `backend/routers/queries.py` actually enforces —
 * the five categories, the three statuses, the requirement that everything but
 * `general` names an entity that exists. Nothing is invented here, so a draft
 * this module accepts is one `POST /queries` accepts. The server stays the
 * authority because it is the only one that can be; this exists so a participant
 * does not discover the rules one 400 at a time.
 *
 * No React and no `api` import: both the participant's screen and the staff
 * console read these rules without either one owning them.
 */

/** Mirrors `Field(min_length=1)` on `QueryCreateRequest`, with room to be kinder. */
export const SUBJECT_MIN = 3;
export const SUBJECT_MAX = 120;
export const BODY_MIN = 3;
export const BODY_MAX = 2000;

/** One thing a query can be about, in the order a participant should scan them. */
export interface QueryCategoryMeta {
  value: QueryCategory;
  label: string;
  /** Who will read it. Printed on the form, because "who sees this" changes what people write. */
  answeredBy: string;
  /** Whether the category must name an entity — `general` is the one that does not. */
  needsTarget: boolean;
}

export const QUERY_CATEGORIES: QueryCategoryMeta[] = [
  {
    value: 'event',
    label: 'An event',
    answeredBy: "that event's own team",
    needsTarget: true,
  },
  {
    value: 'workshop',
    label: 'A workshop',
    answeredBy: "that workshop's volunteers",
    needsTarget: true,
  },
  {
    value: 'hostel',
    label: 'My hostel block',
    answeredBy: "your block's duty team",
    needsTarget: true,
  },
  {
    value: 'mess',
    label: 'My mess hall',
    answeredBy: "that hall's team",
    needsTarget: true,
  },
  {
    value: 'general',
    label: 'Something else',
    answeredBy: 'the core team',
    needsTarget: false,
  },
];

export function categoryMeta(category: string): QueryCategoryMeta | null {
  return QUERY_CATEGORIES.find((c) => c.value === category) ?? null;
}

/**
 * A stored category as a screen should print it.
 *
 * Falls back to the raw value rather than hiding it, so a category the backend
 * gains before this file catches up still reads as a word instead of vanishing
 * from a query the participant can see they raised.
 */
export function categoryLabel(category: string): string {
  const known = categoryMeta(category);
  if (known) return known.label;
  const words = category.replace(/_/g, ' ').trim();
  return words ? words[0].toUpperCase() + words.slice(1) : 'Uncategorised';
}

export const STATUS_LABEL: Record<QueryStatus, string> = {
  open: 'Open',
  assigned: 'With the team',
  resolved: 'Answered',
};

/**
 * Status → the tones every other pill in the app uses.
 *
 * `open` is a warning, not a danger: unanswered is the normal first state of
 * every query ever raised, and painting it red would make a working queue look
 * like a fault. Matches `features/issues/issues.ts` on purpose, so a volunteer
 * reading both boards reads one colour language.
 */
export const STATUS_TONE: Record<QueryStatus, BadgeTone> = {
  open: 'warning',
  assigned: 'info',
  resolved: 'success',
};

export function statusLabel(status: string): string {
  return STATUS_LABEL[status as QueryStatus] ?? status;
}

export function statusTone(status: string): BadgeTone {
  return STATUS_TONE[status as QueryStatus] ?? 'neutral';
}

/** The three the staff console can set, in the order a query moves through them. */
export const ASSIGNABLE_STATUSES: QueryStatus[] = ['open', 'assigned', 'resolved'];

/**
 * What the console's Show selector holds.
 *
 * Two of these are not statuses. `outstanding` spans open and assigned, and
 * `unanswered` cuts across both on whether anybody has actually replied — which
 * is the view that catches the query somebody claimed and then forgot. They live
 * in the same union because they occupy the same control, and a screen switching
 * on a union the module owns cannot drift from the module's own predicates.
 */
export type QueryStatusFilter = QueryStatus | 'outstanding' | 'unanswered' | 'all';

/** One thing a participant may raise a query against. */
export interface QueryTarget {
  category: QueryCategory;
  /** The readable `event_id` / `workshop_id` / `hostel_id` / `mess_id`. */
  id: string;
  name: string;
}

/**
 * What this participant can actually ask about.
 *
 * Narrower than what the backend would accept, deliberately. `POST /queries`
 * takes any existing entity, but a query is routed to that entity's own team,
 * and a team answering questions from somebody with no connection to them is not
 * what the story describes. So the options are the events and workshops this
 * participant registered for, and the block and hall they were actually
 * allotted — the same facts `GET /events/my_registrations`,
 * `GET /hostels/my_hostel` and `GET /mess/my_mess` already report to them.
 *
 * `general` is always available and needs no entity, so a participant is never
 * left with nothing to ask: somebody who has registered for nothing and been
 * allotted nowhere can still reach the core team, which is exactly who they need.
 *
 * Catalogues are consulted only to turn an id into a name. A failed catalogue
 * read degrades to showing the id rather than dropping the option, because the
 * query would still be filed and routed correctly.
 */
export function availableTargets(input: {
  registrations?: readonly MyEventRegistration[] | null;
  events?: readonly Event[] | null;
  workshopRegistrations?: readonly MyWorkshopRegistration[] | null;
  workshops?: readonly Workshop[] | null;
  hostel?: MyHostelResponse | null;
  hostels?: readonly Hostel[] | null;
  mess?: MyMessResponse | null;
  messHalls?: readonly Mess[] | null;
}): QueryTarget[] {
  const targets: QueryTarget[] = [];

  // A registration is resolved against the events list the same way
  // `MyRegistrationsPage`, `EventDetailPage` and the dashboard already resolve
  // one, so this screen agrees with the rest of the app rather than inventing a
  // second rule. One that does not resolve is dropped rather than offered:
  // `POST /queries` 404s on an event id it cannot find, so an unresolvable
  // option would be a button that cannot work.
  for (const registration of input.registrations ?? []) {
    const event = (input.events ?? []).find(
      (candidate) => candidate.event_id === registration.event_id,
    );
    if (event) {
      targets.push({ category: 'event', id: event.event_id, name: event.name });
    }
  }

  for (const registration of input.workshopRegistrations ?? []) {
    const id = registration.workshop_id;
    if (!id) continue;
    const workshop = (input.workshops ?? []).find((w) => w.workshop_id === id);
    targets.push({ category: 'workshop', id, name: workshop?.name ?? id });
  }

  const hostelId = input.hostel?.assigned_hostel;
  if (hostelId) {
    const block = (input.hostels ?? []).find((h) => h.hostel_id === hostelId);
    targets.push({ category: 'hostel', id: hostelId, name: block?.name ?? hostelId });
  }

  const messId = input.mess?.allotted_mess;
  if (messId) {
    const hall =
      input.mess?.mess_details ?? (input.messHalls ?? []).find((m) => m.mess_id === messId) ?? null;
    targets.push({ category: 'mess', id: messId, name: hall?.name ?? messId });
  }

  return targets;
}

/** Which categories have at least one thing to point at, plus `general`. */
export function offerableCategories(targets: readonly QueryTarget[]): QueryCategoryMeta[] {
  return QUERY_CATEGORIES.filter(
    (category) => !category.needsTarget || targets.some((t) => t.category === category.value),
  );
}

export function targetsFor(targets: readonly QueryTarget[], category: string): QueryTarget[] {
  return targets.filter((t) => t.category === category);
}

/** What the form holds while it is being filled in. */
export interface QueryDraft {
  category: string;
  targetId: string;
  subject: string;
  body: string;
}

export const EMPTY_DRAFT: QueryDraft = { category: '', targetId: '', subject: '', body: '' };

/** Field name → message. Empty when the draft is ready to send. */
export type DraftErrors = Partial<Record<keyof QueryDraft, string>>;

/**
 * Everything the backend would refuse, checked before asking it to.
 *
 * Not a superset: no rule here that `POST /queries` does not also enforce, so a
 * participant is never blocked by a rule that exists only in the browser. The
 * one place this is *stricter* is the 3-character floor on subject and body,
 * where the backend accepts 1 — a one-character question is not a question, and
 * refusing it here costs nothing and saves a volunteer a wasted trip.
 */
export function validateDraft(draft: QueryDraft, targets: readonly QueryTarget[]): DraftErrors {
  const errors: DraftErrors = {};
  const meta = categoryMeta(draft.category);

  if (!meta) {
    errors.category = 'Choose what this is about.';
  } else if (meta.needsTarget) {
    const options = targetsFor(targets, meta.value);
    if (!draft.targetId) {
      errors.targetId = `Choose which ${meta.label.replace(/^(An?|My) /i, '').toLowerCase()}.`;
    } else if (!options.some((t) => t.id === draft.targetId)) {
      errors.targetId = 'That is no longer one of your options. Pick again.';
    }
  }

  const subject = draft.subject.trim();
  if (subject.length < SUBJECT_MIN) {
    errors.subject = `Give it a short title — at least ${SUBJECT_MIN} characters.`;
  } else if (subject.length > SUBJECT_MAX) {
    errors.subject = `Keep the title under ${SUBJECT_MAX} characters. Details go below.`;
  }

  const body = draft.body.trim();
  if (body.length < BODY_MIN) {
    errors.body = 'Write out the question so the team can answer it in one reply.';
  } else if (body.length > BODY_MAX) {
    errors.body = `That is over the ${BODY_MAX}-character limit.`;
  }

  return errors;
}

/** A draft as `POST /queries` wants it, or `null` when it is not ready. */
export function draftToRequest(
  draft: QueryDraft,
  targets: readonly QueryTarget[],
): QueryCreateRequest | null {
  const meta = categoryMeta(draft.category);
  if (!meta) return null;
  if (Object.keys(validateDraft(draft, targets)).length > 0) return null;

  return {
    category: meta.value,
    subject: draft.subject.trim(),
    body: draft.body.trim(),
    // Omitted rather than sent null for `general`: the backend drops it either
    // way, and sending a key it is going to discard invites the two to disagree.
    ...(meta.needsTarget ? { target_id: draft.targetId } : {}),
  };
}

/** A query still waiting on somebody. */
export function isOutstanding(query: Pick<QueryRecord, 'status'>): boolean {
  return query.status !== 'resolved';
}

/**
 * Whether anybody on staff has actually said something.
 *
 * Distinct from the status on purpose. A query can be marked `assigned` the
 * moment it is handed to somebody, which tells the participant a name and
 * nothing else; "has anyone replied" is the question they are really asking, and
 * a queue that surfaces it catches the query that was claimed and then forgotten.
 */
export function hasStaffReply(query: Pick<QueryRecord, 'replies'>): boolean {
  return (query.replies ?? []).some((reply) => reply.author_type === 'staff');
}

/** Awaiting a first answer — open or claimed, and nobody has written back. */
export function isUnanswered(query: Pick<QueryRecord, 'status' | 'replies'>): boolean {
  return isOutstanding(query) && !hasStaffReply(query);
}

/** The last thing anybody said, or `null` when nobody has. */
export function latestReply(query: Pick<QueryRecord, 'replies'>): QueryReply | null {
  const replies = query.replies ?? [];
  return replies.length > 0 ? replies[replies.length - 1] : null;
}

/** Counts for a summary row, over whichever list is in hand. */
export interface QueryCounts {
  total: number;
  open: number;
  assigned: number;
  resolved: number;
  /** `open` + `assigned` — what a team still has to act on. */
  outstanding: number;
  /** Outstanding *and* nobody has replied yet. The number that should worry somebody. */
  unanswered: number;
}

export function countQueries(
  queries: readonly Pick<QueryRecord, 'status' | 'replies'>[],
): QueryCounts {
  const counts: QueryCounts = {
    total: queries.length,
    open: 0,
    assigned: 0,
    resolved: 0,
    outstanding: 0,
    unanswered: 0,
  };
  for (const query of queries) {
    if (query.status === 'open') counts.open += 1;
    else if (query.status === 'assigned') counts.assigned += 1;
    else if (query.status === 'resolved') counts.resolved += 1;
    if (isOutstanding(query)) counts.outstanding += 1;
    if (isUnanswered(query)) counts.unanswered += 1;
  }
  return counts;
}

/** Outstanding queries per category, for the dashboard's breakdown. */
export function outstandingByCategory(
  queries: readonly Pick<QueryRecord, 'status' | 'category'>[],
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const query of queries) {
    if (!isOutstanding(query)) continue;
    counts[query.category] = (counts[query.category] ?? 0) + 1;
  }
  return counts;
}

/**
 * Work first, then history — the order a duty console should read in.
 *
 * The API sorts newest first, which is right for a participant's own list and
 * wrong for a queue: a volunteer wants the unanswered ones at the top whatever
 * their age, and an answered query from an hour ago is not more urgent than an
 * open one from yesterday. Within a rank the API's ordering is kept, so this is
 * stable and does not reshuffle on every poll.
 */
const DUTY_RANK: Record<QueryStatus, number> = { open: 0, assigned: 1, resolved: 2 };

export function sortForDuty<T extends Pick<QueryRecord, 'status' | 'replies'>>(
  queries: readonly T[],
): T[] {
  return [...queries].sort((a, b) => {
    // Unanswered beats claimed-and-quiet within the same status, because a query
    // sitting with somebody who has said nothing is the one that gets forgotten.
    const rank = (query: T) => (DUTY_RANK[query.status] ?? 3) * 2 + (isUnanswered(query) ? 0 : 1);
    return rank(a) - rank(b);
  });
}

/**
 * A timestamp as a person should read it.
 *
 * The backend serialises `datetime.utcnow()` *naive* —
 * `2026-08-20T14:22:31.123456`, no offset — and ECMAScript reads a date-time
 * with no offset as **local**, which puts every row 5½ hours out in India. So a
 * `Z` is appended when the string carries no offset of its own, and left alone
 * when it does, keeping this correct if the backend ever sends aware values.
 *
 * `features/issues/issues.ts` carries the identical helper for the identical
 * reason. Two copies rather than one shared import, while both domains are still
 * landing: folding them together is the right refactor, and it is a refactor,
 * not part of either story.
 */
const HAS_OFFSET = /(?:Z|[+-]\d{2}:?\d{2})$/;

/**
 * A backend timestamp as an instant, or `null` when it is not a date.
 *
 * Exported because "how old is this" is a separate question from "how does this
 * read", and the dashboard's staleness rules need the former without the
 * formatting. `null` rather than an epoch date: a rule that cannot tell the age
 * of something must decline to fire, not treat it as 56 years overdue.
 */
export function parseQueryTime(value: string | null | undefined): Date | null {
  const text = (value ?? '').trim();
  if (!text) return null;

  const date = new Date(HAS_OFFSET.test(text) ? text : `${text}Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatQueryTime(value: string | null | undefined): string {
  const text = (value ?? '').trim();
  if (!text) return '';

  const date = parseQueryTime(text);
  if (date === null) return text;

  return date.toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
}

/**
 * "Meera R · Ganga" — the person who asked, on one line.
 *
 * Falls back to the participant id, which is always present, so a row is never
 * headed by nothing. There is no phone number here and none in the API response:
 * a block's team cannot read `/hostels/{id}/statistics`, so a query row must not
 * become the back door to contact details. The thread is the way to reply.
 */
export function askerLine(query: QueryRecord): string {
  return [query.participant_name?.trim() || query.participant_id, query.participant_house?.trim()]
    .filter(Boolean)
    .join(' · ');
}

/**
 * "Ganga Block" — what a query is about, resolved through a name map.
 *
 * `general` has no entity, and saying so beats printing an empty pill: a
 * participant reading their own list needs to see which of their questions went
 * to the core team rather than to a block.
 */
export function targetLabel(
  query: Pick<QueryRecord, 'category' | 'target_id'>,
  names: Record<string, string> = {},
): string {
  if (!query.target_id) return 'Fest-wide';
  return names[query.target_id] ?? query.target_id;
}
