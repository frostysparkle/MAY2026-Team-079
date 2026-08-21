import type { Announcement } from './announcements';

/**
 * Which notices this device has already been shown and told to stop showing.
 *
 * Read state is the one part of an announcement that is genuinely personal, and
 * the backend has nowhere to keep it: there is no per-participant scratch field
 * any route will store, and the notice itself lives in an event document shared
 * by everybody. So dismissal is device-local, exactly as Story 1.2's alert
 * dismissals are — see `features/events/eventChanges.ts`, whose shape this
 * follows deliberately so the two behave the same way.
 *
 * The consequence, which the screens state rather than hide: dismissing a notice
 * on a phone does not dismiss it on a laptop, and clearing site data brings every
 * standing notice back. That is the honest cost of having no server-side read
 * receipt, and it fails in the safe direction — a notice reappears rather than
 * disappearing unread.
 */

/** What one user's device remembers. */
export interface DismissalRecord {
  /** Schema version, so a future shape change discards cleanly instead of misreading. */
  v: 1;
  /** Announcement ids this device has dismissed. */
  dismissed: string[];
}

export const EMPTY_DISMISSALS: DismissalRecord = { v: 1, dismissed: [] };

/**
 * Enough for a fest's worth of notices. The list is also pruned against what is
 * actually on the board on every read, so it only reaches this in the pathological
 * case of an id that vanishes and returns.
 */
const MAX_DISMISSED = 200;

/* --------------------------------------------------------------- storage --- */

const KEY_PREFIX = 'pc_announcements_v1:';

function keyFor(userId: string): string {
  return `${KEY_PREFIX}${userId}`;
}

/** Storage may be unavailable (private mode, tests). Fail quietly, as the auth store does. */
export function readDismissals(userId: string): DismissalRecord {
  try {
    const raw = localStorage.getItem(keyFor(userId));
    if (!raw) return EMPTY_DISMISSALS;
    const parsed = JSON.parse(raw) as DismissalRecord;
    // A hand-edited or half-written value must not crash the screen it feeds,
    // and a record from a future schema must not be read as if it were this one.
    if (!parsed || parsed.v !== 1 || !Array.isArray(parsed.dismissed)) return EMPTY_DISMISSALS;
    return { v: 1, dismissed: parsed.dismissed.filter((id) => typeof id === 'string') };
  } catch {
    return EMPTY_DISMISSALS;
  }
}

export function saveDismissals(userId: string, record: DismissalRecord): void {
  try {
    localStorage.setItem(keyFor(userId), JSON.stringify(record));
  } catch {
    /* ignore */
  }
}

export function clearDismissals(userId: string): void {
  try {
    localStorage.removeItem(keyFor(userId));
  } catch {
    /* ignore */
  }
}

/* ----------------------------------------------------------------- rules --- */

/**
 * Drop the notices this device has dismissed, and prune ids that no longer
 * describe anything.
 *
 * Pruning matters because a deleted or expired notice would otherwise keep its
 * dismissal forever, and an id that a sender reuses would arrive pre-dismissed.
 * Pure, so the rule is testable without storage.
 */
export function applyDismissals(
  announcements: readonly Announcement[],
  record: DismissalRecord,
): { visible: Announcement[]; record: DismissalRecord } {
  const live = new Set(announcements.map((a) => a.id));
  const dismissed = record.dismissed.filter((id) => live.has(id));
  const hidden = new Set(dismissed);

  return {
    visible: announcements.filter((a) => !hidden.has(a.id)),
    record: { v: 1, dismissed: dismissed.slice(0, MAX_DISMISSED) },
  };
}

/* ----------------------------------------------------------- entry points --- */

/**
 * Hide everything this device has dismissed, writing the pruned record back.
 *
 * Called from the caller's load path rather than an effect of its own, so it runs
 * on exactly the notices the caller just read and adds no request. Idempotent.
 */
export function withoutDismissed(
  userId: string,
  announcements: readonly Announcement[],
): Announcement[] {
  if (!userId) return [...announcements];
  const { visible, record } = applyDismissals(announcements, readDismissals(userId));
  saveDismissals(userId, record);
  return visible;
}

/** Dismiss one notice. */
export function dismissAnnouncement(userId: string, announcementId: string): void {
  if (!userId) return;
  const record = readDismissals(userId);
  if (record.dismissed.includes(announcementId)) return;
  saveDismissals(userId, {
    v: 1,
    dismissed: [announcementId, ...record.dismissed].slice(0, MAX_DISMISSED),
  });
}

/** Dismiss everything currently on screen. */
export function dismissAllAnnouncements(
  userId: string,
  announcements: readonly Announcement[],
): void {
  if (!userId) return;
  const record = readDismissals(userId);
  const merged = [...announcements.map((a) => a.id), ...record.dismissed];
  saveDismissals(userId, { v: 1, dismissed: [...new Set(merged)].slice(0, MAX_DISMISSED) });
}
