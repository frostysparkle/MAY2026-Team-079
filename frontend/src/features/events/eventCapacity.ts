import type { EventCapacityCountsResponse } from '@/api/types';
import {
  deriveOccupancy,
  OCCUPANCY_STATUS,
  occupancyTone,
  type OccupancyStatus,
} from '@/features/occupancy';
import type { BadgeTone } from '@/components/ui';

/**
 * Stories 3.2 and 3.3 — how full an event is.
 *
 * Both halves of the subtraction already existed and neither was ever put
 * against the other: `capacity` became a published field on the event with story
 * 1.3 (it rides in the `registration` map — see `eventExtras.ts`), and attendance
 * scans have been logged since story 3.1. This module is the one place that turns
 * the pair into "entries left", so the scanner, the participation screen, the
 * control board, and the participant's event page can never quote four different
 * numbers.
 *
 * The thresholds, labels, and tones are *not* redefined here. They come from
 * `features/occupancy`, the same vocabulary hostels and mess halls answer
 * "how full is this?" with, so an event reading "Filling" means exactly what a
 * block reading "Filling" means.
 *
 * ## Two conventions inherited from `features/occupancy`
 *
 *  - **`null` is not zero.** A count that could not be read stays `null` and
 *    renders as "—". A UHC caller, for instance, gets a participation response
 *    with no `total_daily_scans` at all.
 *  - **Never negative.** An over-admitted gate has *no* entries left, not "-12"
 *    of them. The overshoot is reported separately, as `over`.
 *
 * ## What "admitted" counts
 *
 * Distinct participants scanned in today — heads, not scan rows. The scan
 * endpoint records one row per `(participant, scanner, day)` so that each
 * volunteer keeps an accurate tally of their own gate, which means one person
 * admitted by two volunteers writes two rows. Every endpoint that reports
 * *attendance* now counts distinct participants over those rows, so a single
 * reading reaches every screen and no caller has to know the difference.
 */

/** What the admitted figure counts, worded once for every screen that shows it. */
export const ADMITTED_NOTE = 'unique participants scanned in today';

export interface EventCapacityReadout {
  /**
   * The limit the organiser published. Always > 0; an unset limit yields `null`
   * from `readEventCapacity` rather than a readout claiming a capacity of 0.
   */
  capacity: number;
  /** How many have come through today, or `null` when unreadable. */
  admitted: number | null;
  /** Entries still available today. Never negative; `null` when unreadable. */
  remaining: number | null;
  /** Share of the capacity used. May exceed 100 when the gate over-admitted. */
  percent: number | null;
  status: OccupancyStatus | null;
  /** Admitted has met or passed the published limit. */
  atCapacity: boolean;
  /** How many past the limit. `0` unless the gate has over-admitted. */
  over: number;
  /** Status word — "Available", "Filling", "Full". Empty when unreadable. */
  label: string;
  tone: BadgeTone;
  /** Progress-bar tone tracking the same status, so bar and badge agree. */
  barTone: 'brand' | 'warning' | 'danger';
  /** One line fit for a subtitle, e.g. "58 of 200 entries left". */
  summary: string;
}

function summarise(capacity: number, remaining: number | null, over: number): string {
  if (remaining === null) return `Capacity ${capacity.toLocaleString()}`;
  if (over > 0) return `${over.toLocaleString()} over a capacity of ${capacity.toLocaleString()}`;
  if (remaining === 0) return `Capacity reached — 0 of ${capacity.toLocaleString()} entries left`;
  return `${remaining.toLocaleString()} of ${capacity.toLocaleString()} entries left`;
}

/**
 * How full one event is, or `null` when there is nothing to report.
 *
 * `null` — rather than a zeroed readout — is returned when the organiser has
 * published no capacity, which is the case for most events. A screen that gets
 * `null` hides the readout entirely: inventing "0 left" for an event with no
 * declared limit would turn a blank field into a closed gate.
 *
 * `count` is whichever figure the caller is measuring against the limit —
 * attendance for a gate, registrations for "will there be a place for me".
 */
export function readEventCapacity(
  capacity: number | undefined | null,
  count: number | null | undefined,
): EventCapacityReadout | null {
  if (capacity === undefined || capacity === null || capacity <= 0) return null;

  const occupancy = deriveOccupancy(capacity, count ?? null);
  const admitted = occupancy.allocated;
  const over = admitted === null ? 0 : Math.max(0, admitted - capacity);

  return {
    capacity,
    admitted,
    remaining: occupancy.available,
    percent: occupancy.percent,
    status: occupancy.status,
    atCapacity: admitted !== null && admitted >= capacity,
    over,
    label: occupancy.status === null ? '' : OCCUPANCY_STATUS[occupancy.status].label,
    tone: occupancy.status === null ? 'neutral' : OCCUPANCY_STATUS[occupancy.status].tone,
    barTone: occupancy.status === null ? 'brand' : occupancyTone(occupancy.status),
    summary: summarise(capacity, occupancy.available, over),
  };
}

/* ------------------------------------------------- participant crowd view --- */

/**
 * How busy an event is, as a participant reads it — Story 3.3.
 *
 * Two readings of the same published capacity, kept apart because they answer
 * different questions and a participant acts on them differently: `venue` is
 * "how many are in there right now" (worth walking over?), `demand` is "how many
 * have signed up" (will there be room at all?).
 */
export interface EventCrowd {
  /** Current registrations — cancellations are already deducted. */
  registered: number;
  /** Distinct participants scanned in today. */
  attendedToday: number;
  /** Attendance against the published capacity. `null` when none is published. */
  venue: EventCapacityReadout | null;
  /** Registrations against the published capacity. `null` on the same terms. */
  demand: EventCapacityReadout | null;
}

/** Join the counts endpoint's response to the capacity the client already holds. */
export function readEventCrowd(
  counts: EventCapacityCountsResponse,
  capacity: number | undefined,
): EventCrowd {
  return {
    registered: counts.registered,
    attendedToday: counts.attended_today,
    venue: readEventCapacity(capacity, counts.attended_today),
    demand: readEventCapacity(capacity, counts.registered),
  };
}
