import type { Event, PublicEventRecord } from '@/api/types';
import {
  readEventExtras,
  readRegistrationWindow,
  type EventEntryInfo,
  type EventFaq,
} from './eventExtras';
import {
  getPublicEventCategory,
  type PublicEventCategory,
  type PublicEventCategorySlug,
} from './publicEvents';

/**
 * The one shape an event page renders, whichever endpoint the event came from —
 * the pre-login brochure or an authenticated fetch. Everything the page needs is
 * normalised here, so the view layer does no source-specific branching and an
 * event looks the same on both.
 */

export interface EventViewRound {
  name: string;
  when: string;
  venue?: string;
  description?: string;
}

export interface EventViewPrize {
  label: string;
  amount: string;
}

export interface EventViewMeta {
  label: string;
  value: string;
}

/**
 * The category an event page is dressed in: its name, accent colour, and the
 * artwork a missing poster falls back to.
 *
 * Deliberately narrower than `PublicEventCategory` (which satisfies it) because
 * the admin dashboard has to render events with no public category at all —
 * `event_type: 'others'` — and those have no slug and no artwork.
 */
export interface EventViewCategory {
  /** Public category slug. Absent for an unlisted event. */
  slug?: PublicEventCategorySlug;
  label: string;
  accent: string;
  /** Fallback artwork. Empty when the category has none. */
  image: string;
}

export interface EventView {
  /** Stable id used in the URL. */
  id: string;
  name: string;
  poster: string;
  category: EventViewCategory;
  description: string;
  meta: EventViewMeta[];
  prizes: EventViewPrize[];
  timeline: EventViewRound[];
  faqs: EventFaq[];
  rulebook?: string;
  /**
   * Entries the event admits, when the organiser has published a limit. Absent
   * on the many events that have never set one.
   */
  capacity?: number;
  /** What to bring and when to turn up. Always present; often entirely empty. */
  entry: EventEntryInfo;
  /**
   * Where the record came from:
   *  - `public`   the pre-login brochure projection — no registration fields,
   *               so the page links into the app to register.
   *  - `backend`  a full record fetched with a token, which can be registered
   *               against in place.
   */
  source: 'backend' | 'public';
  /** Present only for `backend`; the brochure projection is not a full record. */
  event?: Event;
}

/* --------------------------------------------------------- category map --- */

/**
 * The backend's `event_type` vocabulary (`technical | culturals | sports |
 * others`) and the catalogue's category slugs (`technicals | culturals |
 * sports`) agree on two of three values and disagree on the third.
 */
export function categorySlugForEventType(eventType: string): PublicEventCategorySlug | null {
  switch (eventType.trim().toLowerCase()) {
    case 'technical':
    case 'technicals':
      return 'technicals';
    case 'culturals':
    case 'cultural':
      return 'culturals';
    case 'sports':
      return 'sports';
    default:
      // `others` and anything unrecognised has no public category to sit in.
      return null;
  }
}

/* ------------------------------------------------------------ formatting --- */

/**
 * Which strings are timestamps, and which are display copy.
 *
 * A parse-failure fallback is not safe here: `new Date('1 Jun')` does *not*
 * fail — V8 reads it as 1 June **2001** — so a brochure string like
 * `10 Jun, 03:30 pm` would be silently rewritten into a formatted 2001 date.
 *
 * Only ISO-shaped values are treated as timestamps, which is exactly what the
 * admin form's `datetime-local` inputs emit (`2026-06-13T14:00`). Anything else
 * is copy an author wrote and is returned untouched.
 */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}/;

/**
 * `2026-06-13T14:00` → `13 Jun, 02:00 pm`. Non-timestamps pass through.
 *
 * Exported because the schedule-change alerts print the same round times, and
 * the `new Date('1 Jun')` trap documented above is not worth re-deriving in a
 * second place.
 */
export function formatDateTime(value: string | undefined): string {
  if (!value) return '';
  if (!ISO_DATE.test(value.trim())) return value;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
}

/** `2026-06-13T14:00` → `13 June`. Non-timestamps pass through. */
function formatDate(value: string | undefined): string {
  if (!value) return '';
  if (!ISO_DATE.test(value.trim())) return value;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'long' });
}

function teamSizeLabel(min: number, max: number): string | null {
  if (!min && !max) return null;
  if (min === max) return String(min);
  return `${min} – ${max}`;
}

/* ------------------------------------------------- backend (Super Admin) --- */

/** The public category an event belongs to, if it has one. */
function publicCategoryFor(eventType: string): PublicEventCategory | undefined {
  const slug = categorySlugForEventType(eventType);
  return slug ? getPublicEventCategory(slug) : undefined;
}

/**
 * Frame for an event the public catalogue has no home for (`event_type:
 * 'others'`). Neutral grey and no artwork, so it reads as deliberately unlisted
 * rather than borrowing another category's identity.
 */
export const UNLISTED_CATEGORY: EventViewCategory = {
  label: 'Unlisted',
  accent: '#4B5563',
  image: '',
};

/**
 * Normalise a full backend event, fetched with a token. Carries the live record,
 * so the page can register against it in place.
 */
export function backendEventView(event: Event): EventView | null {
  const category = publicCategoryFor(event.event_type);
  return category ? buildEventView(event, category, event) : null;
}

/** Normalise an event from the pre-login brochure (`GET /events/public`). */
export function publicEventView(record: PublicEventRecord): EventView | null {
  const category = publicCategoryFor(record.event_type);
  return category ? buildEventView(record, category) : null;
}

/**
 * Normalise an event for a dashboard that must be able to show *every* event —
 * the Super Admin's and the participant's both. Never returns null: an event
 * with no public category is framed as unlisted instead of being dropped,
 * because an admin still has to find, edit, and delete it, and a participant
 * who is registered for one still has to open it.
 */
export function fullEventView(event: Event): EventView {
  return buildEventView(event, publicCategoryFor(event.event_type) ?? UNLISTED_CATEGORY, event);
}

/** Normalise an event record into the one shape every event page renders. */
function buildEventView(
  event: PublicEventRecord,
  category: EventViewCategory,
  live?: Event,
): EventView {
  const extras = readEventExtras(event.registration);
  const window = readRegistrationWindow(event.registration);

  return {
    id: event.event_id,
    name: event.name,
    poster: event.poster?.trim() || category.image,
    category,
    description: event.description,
    // A curated meta list wins; otherwise derive the tiles from the columns.
    meta: extras.meta.length > 0 ? extras.meta.map((m) => ({ ...m })) : derivedMeta(event, window),
    prizes: event.prize_money.map((p, i) => ({
      label: p.position,
      // "1 Plaque" and "₹10000 each" cannot be held by an int column.
      amount: extras.prizeAmounts[i] || `₹${p.amount.toLocaleString('en-IN')}`,
    })),
    timeline: event.schedule.map((r, i) => ({
      name: r.name,
      when:
        extras.roundWhen[i] ||
        [formatDateTime(r.start_time), formatDateTime(r.end_time)].filter(Boolean).join(' – '),
      venue: r.venue,
      description: r.description,
    })),
    faqs: extras.faqs,
    rulebook: extras.rulebook,
    capacity: extras.capacity,
    entry: extras.entry,
    source: live ? 'backend' : 'public',
    event: live,
  };
}

/** The meta tiles an event implies when it carries no curated display list. */
function derivedMeta(
  event: PublicEventRecord,
  window: { startTime?: string; endTime?: string },
): EventViewMeta[] {
  const meta: EventViewMeta[] = [];

  const team = teamSizeLabel(event.team?.min ?? 1, event.team?.max ?? 1);
  if (team) meta.push({ label: 'Team Size', value: team });

  if (event.schedule.length > 0) {
    meta.push({ label: 'Rounds', value: String(event.schedule.length) });
    const first = event.schedule[0];
    const last = event.schedule[event.schedule.length - 1];
    if (first.start_time) meta.push({ label: 'Start Date', value: formatDate(first.start_time) });
    if (last.end_time) meta.push({ label: 'End Date', value: formatDate(last.end_time) });
  }

  if (window.startTime) meta.push({ label: 'Reg. Start', value: formatDate(window.startTime) });
  if (window.endTime) meta.push({ label: 'Reg. End', value: formatDate(window.endTime) });

  return meta;
}

/**
 * Every brochure event belonging on the given public category page.
 *
 * Unlike the in-app catalogue this does *not* filter on `open`: `open` is the
 * registration state, not a publication flag, so closing registration must not
 * make an event disappear from the public programme.
 */
export function publicEventsForCategory(
  events: PublicEventRecord[],
  slug: PublicEventCategorySlug,
): EventView[] {
  return events
    .filter((e) => categorySlugForEventType(e.event_type) === slug)
    .map(publicEventView)
    .filter((view): view is EventView => view !== null);
}
