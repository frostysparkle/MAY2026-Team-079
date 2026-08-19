/**
 * Pure derivations for the control board's top half — the pulse row, the live
 * flow chart, the pipeline, and the capacity board.
 *
 * Same discipline as `festMetrics`: data in, figures out, no hooks and no clock
 * read that is not injectable. The two conventions from that module carry over
 * unchanged, and they are the reason this file is as verbose as it is:
 *
 *  - **`null` is not zero.** Per-entity statistics are Super-Admin-only and fail
 *    individually, so an unreadable figure stays `null` and renders as "—".
 *  - **Partial totals are `null`.** A sum over a set where some members failed
 *    understates the answer while looking exactly like a real one.
 */

import { DOMAIN_COLOR } from '@/components/ui';
import { occupancyStatus, type OccupancyStatus } from '@/features/occupancy';
import type { HostelRow } from '@/features/hostels/hostelOccupancy';
import type { MessRow } from '@/features/mess/messOccupancy';
import { bucketByHour, bucketByDay, rowsOnDay } from '../auditSeries';
import type { AuditFeeds } from '../useFestSnapshot';
import type { TrendSeries } from './trendScale';

/* ------------------------------------------------------------- live flow --- */

/** Which activity streams the board plots, and in what colour. */
export const STREAM_ORDER = ['arrivals', 'departures', 'meals'] as const;
export type StreamKey = (typeof STREAM_ORDER)[number];

export const STREAM_LABEL: Record<StreamKey, string> = {
  arrivals: 'Check-ins',
  departures: 'Check-outs',
  meals: 'Meal swipes',
};

/**
 * Stream colours.
 *
 * Arrivals and meals borrow their owning domain's identity hue, which is what
 * ties the chart to the Hostels and Mess panels below it. Departures cannot do
 * the same — it is the *other half* of the hostel stream, so it would collide
 * with arrivals — and it deliberately does not take another domain's colour
 * either, since that would imply it belongs to Events or Staff. Muted grey is
 * the honest choice: it is the counter-movement, not a domain.
 */
export const STREAM_COLOR: Record<StreamKey, string> = {
  arrivals: DOMAIN_COLOR.hostels,
  departures: 'var(--color-input)',
  meals: DOMAIN_COLOR.mess,
};

function feedFor(audit: AuditFeeds, stream: StreamKey) {
  if (stream === 'arrivals') return audit.hostelEntry;
  if (stream === 'departures') return audit.hostelExit;
  return audit.messScans;
}

/** The three campus streams bucketed by hour, oldest first. */
export function campusStreams(
  audit: AuditFeeds,
  hours = 24,
  now: Date = new Date(),
): TrendSeries[] {
  return STREAM_ORDER.map((stream) => ({
    key: stream,
    label: STREAM_LABEL[stream],
    color: STREAM_COLOR[stream],
    points: bucketByHour(feedFor(audit, stream), hours, now),
  }));
}

/** Today's total for one stream. */
export function streamToday(audit: AuditFeeds, stream: StreamKey, day: Date = new Date()): number {
  return rowsOnDay(feedFor(audit, stream), day).length;
}

/* ------------------------------------------------------------ trend deck --- */

/**
 * What the trend deck can plot, one at a time.
 *
 * A superset of the hero's three streams: registrations are here and not there
 * because they happen in the weeks *before* the fest, so on the hero's 24-hour
 * axis they would be a flat zero dragging the shared ceiling of the other two
 * lines. Given its own scale and a by-day axis, the same feed is one of the more
 * useful series on the board.
 *
 * Ordered with meals first because it is the highest-volume feed and the one an
 * admin opens the deck to look at.
 */
export const DECK_ORDER = ['meals', 'arrivals', 'departures', 'registrations'] as const;
export type DeckKey = (typeof DECK_ORDER)[number];

export const DECK_LABEL: Record<DeckKey, string> = {
  ...STREAM_LABEL,
  registrations: 'Event sign-ups',
};

export const DECK_COLOR: Record<DeckKey, string> = {
  ...STREAM_COLOR,
  registrations: DOMAIN_COLOR.events,
};

/** Which audit feed name each deck series is truncated by, when it is. */
const DECK_TRUNCATION: Record<DeckKey, string> = {
  meals: 'meal scans',
  arrivals: 'hostel check-ins',
  departures: 'hostel check-outs',
  registrations: 'event registrations',
};

function deckFeed(audit: AuditFeeds, key: DeckKey) {
  return key === 'registrations' ? audit.eventRegistrations : feedFor(audit, key);
}

/** True when this series' feed came back at its fetch limit, so totals are floors. */
export function deckIsFloored(audit: AuditFeeds, key: DeckKey): boolean {
  return audit.truncated.includes(DECK_TRUNCATION[key]);
}

/** One deck series, bucketed by hour or by calendar day. */
export function deckSeries(
  audit: AuditFeeds,
  key: DeckKey,
  range: 'hours' | 'days',
  now: Date = new Date(),
): TrendSeries {
  const logs = deckFeed(audit, key);
  return {
    key,
    label: DECK_LABEL[key],
    color: DECK_COLOR[key],
    points: range === 'days' ? bucketByDay(logs) : bucketByHour(logs, 24, now),
  };
}

/* -------------------------------------------------------------- pipeline --- */

/**
 * A stage in the participant funnel: how many people have reached this far.
 *
 * `of` is the stage's own denominator rather than the funnel's first stage,
 * because the funnel is not strictly nested — a participant can register for an
 * event without ever requesting a bed. Each stage states what it is a share of.
 */
export interface PipelineStage {
  key: string;
  label: string;
  /** `null` when the figure could not be read. */
  value: number | null;
  of: number;
  color: string;
  /** One line on what this stage means. */
  note: string;
}

export function pipelineStages(input: {
  registered: number | null;
  profileComplete: number | null;
  hostelAllotted: number | null;
  messAllotted: number | null;
  onCampus: number | null;
  withEvents: number | null;
  withWorkshops: number | null;
}): PipelineStage[] {
  // Every stage is a share of registrations, so the bars are directly
  // comparable. `|| 1` only guards the divide; a zero-registration fest draws
  // every bar empty, which is correct.
  const total = input.registered ?? 0;

  return [
    {
      key: 'registered',
      label: 'Registered',
      value: input.registered,
      of: total || 1,
      color: DOMAIN_COLOR.people,
      note: 'Accounts created',
    },
    {
      key: 'profile',
      label: 'Profile complete',
      value: input.profileComplete,
      of: total || 1,
      color: DOMAIN_COLOR.people,
      note: 'Can be allocated and scanned',
    },
    {
      key: 'hostel',
      label: 'Hostel allotted',
      value: input.hostelAllotted,
      of: total || 1,
      color: DOMAIN_COLOR.hostels,
      note: 'Has a bed assigned',
    },
    {
      key: 'mess',
      label: 'Mess allotted',
      value: input.messAllotted,
      of: total || 1,
      color: DOMAIN_COLOR.mess,
      note: 'Has a hall assigned',
    },
    {
      key: 'events',
      label: 'In an event',
      value: input.withEvents,
      of: total || 1,
      color: DOMAIN_COLOR.events,
      note: 'Registered for at least one',
    },
    {
      key: 'workshops',
      label: 'In a workshop',
      value: input.withWorkshops,
      of: total || 1,
      color: DOMAIN_COLOR.workshops,
      note: 'Booked at least one seat',
    },
    {
      key: 'campus',
      label: 'On campus now',
      value: input.onCampus,
      of: total || 1,
      color: 'var(--color-success)',
      note: 'Currently scanned into a hostel',
    },
  ];
}

/* ------------------------------------------------------- capacity board --- */

/**
 * One row of the capacity board: a hostel block or a mess hall, described in the
 * one shape the table and the drill-in both read.
 *
 * Hostels and mess halls are genuinely different things, and the board still
 * lists them together — because the question it answers ("where on campus is
 * running out of room?") does not care which inventory the answer comes from,
 * and an admin should not have to compare two tables to find out. The `kind`
 * column keeps them distinguishable, and `inside` is hostel-only because mess
 * statistics report no live occupancy.
 */
export interface CapacityRow {
  id: string;
  kind: 'Hostel' | 'Mess';
  name: string;
  /** Category for a block, dietary designation for a hall. */
  detail: string;
  capacity: number;
  allocated: number | null;
  available: number | null;
  percent: number | null;
  status: OccupancyStatus | null;
  /** Allocated participants currently scanned in. Hostels only; `null` for mess. */
  inside: number | null;
  staffed: boolean;
  scanning: boolean;
  color: string;
  /** The section that owns this row. */
  to: string;
}

export function capacityRows(
  hostels: HostelRow[],
  mess: MessRow[],
  routes: { hostels: string; mess: string },
): CapacityRow[] {
  const blocks: CapacityRow[] = hostels.map((row) => ({
    id: row.id,
    kind: 'Hostel',
    name: row.name,
    detail: row.categoryLabel,
    capacity: row.capacity,
    allocated: row.allocated,
    available: row.available,
    percent: row.percent,
    status: row.status,
    inside: row.inside,
    staffed: row.staffed,
    scanning: row.scanning,
    color: DOMAIN_COLOR.hostels,
    to: routes.hostels,
  }));

  const halls: CapacityRow[] = mess.map((row) => ({
    id: row.id,
    kind: 'Mess',
    name: row.name,
    detail: row.typeLabel,
    capacity: row.capacity,
    allocated: row.allocated,
    available: row.available,
    percent: row.percent,
    status: row.status,
    inside: null,
    staffed: row.staffed,
    scanning: row.scanning,
    color: DOMAIN_COLOR.mess,
    to: routes.mess,
  }));

  // Fullest first, and rows whose statistics could not be read sink to the
  // bottom rather than sorting as if they were empty.
  return [...blocks, ...halls].sort((a, b) => (b.percent ?? -1) - (a.percent ?? -1));
}

/**
 * Aggregate figures for the capacity board's "everything" view.
 *
 * The averaged percentage is deliberately *not* the campus fill rate — it is the
 * mean of the rows' own rates, which is what makes a single 100% block visible
 * next to nine empty ones. The true campus rate is `allocated / capacity` and is
 * reported separately as `percent`.
 */
export function capacityTotals(rows: CapacityRow[]): {
  capacity: number;
  allocated: number | null;
  percent: number | null;
  inside: number | null;
  staffed: number;
  unstaffed: number;
  underPressure: number;
  readable: number;
} {
  const capacity = rows.reduce((sum, row) => sum + row.capacity, 0);
  const allRead = rows.length > 0 && rows.every((row) => row.allocated !== null);
  const allocated = allRead ? rows.reduce((sum, row) => sum + (row.allocated ?? 0), 0) : null;

  const insideRows = rows.filter((row) => row.kind === 'Hostel');
  const insideRead = insideRows.length > 0 && insideRows.every((row) => row.inside !== null);

  return {
    capacity,
    allocated,
    percent: allocated !== null && capacity > 0 ? (allocated / capacity) * 100 : null,
    inside: insideRead ? insideRows.reduce((sum, row) => sum + (row.inside ?? 0), 0) : null,
    staffed: rows.filter((row) => row.staffed).length,
    unstaffed: rows.filter((row) => !row.staffed).length,
    underPressure: rows.filter((row) => row.percent !== null && row.percent >= PRESSURE_PERCENT)
      .length,
    readable: rows.filter((row) => row.allocated !== null).length,
  };
}

/**
 * The fill share at which a place is worth naming. Matches `PRESSURE_THRESHOLD`
 * in `festAlerts`, so the rail's "N places are nearly full" and the capacity
 * board's pressure count can never disagree.
 */
export const PRESSURE_PERCENT = 90;

/** Rows at or above the pressure threshold, worst first, for the attention rail. */
export function pressureRows(rows: CapacityRow[]): CapacityRow[] {
  return rows.filter((row) => row.percent !== null && row.percent >= PRESSURE_PERCENT);
}

/** How a row's fill reads on a badge or a rail entry. */
export function capacityStatusText(row: CapacityRow): string {
  if (row.percent === null) return 'occupancy unreadable';
  if (row.allocated !== null && row.allocated > row.capacity) return 'over capacity';
  return `${Math.round(row.percent)}% full`;
}

export { occupancyStatus };
