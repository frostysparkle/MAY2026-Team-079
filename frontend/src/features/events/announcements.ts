import type { Announcement, AnnouncementCreateRequest, AnnouncementPriority } from '@/api/types';
import type { BadgeTone } from '@/components/ui';

/**
 * Publishing and reading an event's own announcements — Story 8.2.
 *
 * `POST /events/{id}/announcements` and its two read siblings
 * (`GET /events/{id}/announcements`, `GET /events/{id}/announcements/stream`)
 * have been in the backend since Sprint 2 (`backend/routers/events.py`) with
 * nothing on the frontend calling them. This module is the pure half: the
 * priority vocabulary, the draft the compose form holds, and the validation
 * that mirrors what `AnnouncementCreateRequest` actually enforces
 * (`backend/models.py`), so a draft this file accepts is one the server
 * accepts too.
 *
 * This is deliberately *not* the same mechanism as `eventChanges.ts`. That
 * module detects a venue/time edit by diffing two reads of `GET /events` on
 * the participant's own device — useful, but silent until the device happens
 * to reload the event, and blind to anything that is not a schedule field. An
 * announcement is an organiser's own sentence ("Round 2 has moved to the KV
 * Ground annexe — bring your laptop"), written once and read by everyone
 * registered, which is what the story actually asks for. The two are shown
 * together on the participant's event page rather than merged, because they
 * answer different questions: "what changed" vs. "what the team wants me to
 * know".
 *
 * No React and no `api` import: both the compose form and the read-only list
 * read these rules without either owning them.
 */

/** Mirrors `ANNOUNCEMENT_PRIORITIES` in `backend/models.py`. */
export const PRIORITIES: { value: AnnouncementPriority; label: string }[] = [
  { value: 'low', label: 'Low' },
  { value: 'mid', label: 'Normal' },
  { value: 'high', label: 'Urgent' },
];

/** Mirrors `Field(min_length=1)` on `AnnouncementCreateRequest.message`. */
export const MESSAGE_MIN = 1;
/**
 * The backend sets no ceiling on `message`. A generous but finite bound stops
 * an announcement from reading as a second description field on the event
 * page it is posted to — the backend stays the authority on what is actually
 * refused (nothing, past 1 character), and this is a UI courtesy only.
 */
export const MESSAGE_MAX = 500;

export const STATUS_TONE: Record<AnnouncementPriority, BadgeTone> = {
  low: 'neutral',
  mid: 'info',
  high: 'warning',
};

export function priorityLabel(priority: string): string {
  return PRIORITIES.find((p) => p.value === priority)?.label ?? priority;
}

export function priorityTone(priority: string): BadgeTone {
  return STATUS_TONE[priority as AnnouncementPriority] ?? 'neutral';
}

/** What the compose form holds while it is being filled in. */
export interface AnnouncementDraft {
  message: string;
  priority: AnnouncementPriority;
}

export const EMPTY_DRAFT: AnnouncementDraft = { message: '', priority: 'mid' };

/** Field name → message. Empty when the draft is ready to send. */
export type DraftErrors = Partial<Record<keyof AnnouncementDraft, string>>;

/**
 * Everything the backend would refuse, checked before asking it to.
 *
 * Not a superset: no rule here that `POST /events/{id}/announcements` does not
 * also enforce, so an organiser is never blocked by a rule that exists only in
 * the browser.
 */
export function validateDraft(draft: AnnouncementDraft): DraftErrors {
  const errors: DraftErrors = {};
  const message = draft.message.trim();

  if (message.length < MESSAGE_MIN) {
    errors.message = 'Write what you want registrants to see.';
  } else if (message.length > MESSAGE_MAX) {
    errors.message = `Keep it under ${MESSAGE_MAX} characters.`;
  }

  return errors;
}

/** A draft as `POST /events/{id}/announcements` wants it, or `null` when not ready. */
export function draftToRequest(draft: AnnouncementDraft): AnnouncementCreateRequest | null {
  if (Object.keys(validateDraft(draft)).length > 0) return null;
  return { message: draft.message.trim(), priority: draft.priority };
}

/** Newest first — the API already sorts this way, but a locally-inserted row should read the same. */
export function sortNewestFirst(announcements: readonly Announcement[]): Announcement[] {
  return [...announcements].sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
}

/**
 * A timestamp as a person should read it.
 *
 * The backend serialises `datetime.utcnow()` *naive* —
 * `2026-08-20T14:22:31.123456`, no offset — and ECMAScript reads a date-time
 * with no offset as **local**, which puts every row 5½ hours out in India. So
 * a `Z` is appended when the string carries no offset of its own, and left
 * alone when it does. Same rule, same reason, as `features/queries/queries.ts`
 * and `features/issues/issues.ts`; kept as its own copy rather than a shared
 * import while all three domains are still landing independently.
 */
const HAS_OFFSET = /(?:Z|[+-]\d{2}:?\d{2})$/;

export function parseAnnouncementTime(value: string | null | undefined): Date | null {
  const text = (value ?? '').trim();
  if (!text) return null;

  const date = new Date(HAS_OFFSET.test(text) ? text : `${text}Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatAnnouncementTime(value: string | null | undefined): string {
  const text = (value ?? '').trim();
  if (!text) return '';

  const date = parseAnnouncementTime(text);
  if (date === null) return text;

  return date.toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
}
