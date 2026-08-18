import type { BadgeTone } from '@/components/ui';

/**
 * The shared vocabulary for "how full is this?".
 *
 * Hostels and mess halls both answer that question the same way — a capacity, a
 * count of who has been allocated, and how much of it is taken — so the
 * thresholds, the labels, and the colours live here rather than once per section.
 * Two copies of "what counts as full" would eventually disagree, and a block
 * reading "Filling" beside a hall reading "Available" at the same percentage is
 * exactly the kind of drift that erodes trust in a dashboard.
 *
 * Every figure derived from statistics is nullable throughout. The statistics
 * endpoints are Super-Admin-only, so `null` means "not readable by this user" and
 * must never be flattened to `0`, which would read as "nobody is allocated".
 */

export type OccupancyStatus = 'empty' | 'available' | 'filling' | 'full';

/**
 * What a card says where a statistics-derived figure would go when it could not
 * be read. Named once so hostels and mess never explain the same gap in two
 * different words, and so the reason is stated rather than implied by a dash.
 */
export const OCCUPANCY_UNREADABLE = 'Needs Super Admin access';

/** Label and badge tone per status, so a status reads identically everywhere. */
export const OCCUPANCY_STATUS: Record<OccupancyStatus, { label: string; tone: BadgeTone }> = {
  empty: { label: 'Empty', tone: 'neutral' },
  available: { label: 'Available', tone: 'success' },
  filling: { label: 'Filling', tone: 'warning' },
  full: { label: 'Full', tone: 'danger' },
};

/** The one place the fill thresholds are defined. */
export function occupancyStatus(percent: number): OccupancyStatus {
  if (percent <= 0) return 'empty';
  if (percent >= 100) return 'full';
  return percent < 75 ? 'available' : 'filling';
}

/** Progress tone tracks the status, so a filling row reads as amber, not brand. */
export function occupancyTone(status: OccupancyStatus): 'brand' | 'warning' | 'danger' {
  if (status === 'full') return 'danger';
  if (status === 'filling') return 'warning';
  return 'brand';
}

/**
 * The occupancy fields every row shares, derived from a capacity and an
 * allocated count.
 */
export interface Occupancy {
  capacity: number;
  /** How many are allocated. `null` when statistics are unreadable. */
  allocated: number | null;
  available: number | null;
  percent: number | null;
  status: OccupancyStatus | null;
}

/** Derive the occupancy fields for one row. */
export function deriveOccupancy(capacity: number, allocated: number | null): Occupancy {
  if (allocated === null) {
    return { capacity, allocated: null, available: null, percent: null, status: null };
  }

  const percent = capacity <= 0 ? 0 : (allocated / capacity) * 100;

  return {
    capacity,
    allocated,
    // Never negative: an over-allocated row has no places left, not "-4" of them.
    available: Math.max(0, capacity - allocated),
    percent,
    status: occupancyStatus(percent),
  };
}

/**
 * Total allocated across a set of rows, or `null` unless every one could be read.
 * Partial statistics would understate the total and read as a real figure.
 */
export function totalAllocated(rows: { allocated: number | null }[]): number | null {
  if (!rows.every((row) => row.allocated !== null)) return null;
  return rows.reduce((sum, row) => sum + (row.allocated ?? 0), 0);
}

/** A share as a percentage, or `null` when there is nothing to divide by. */
export function share(part: number | null, whole: number): number | null {
  if (part === null || whole <= 0) return null;
  return (part / whole) * 100;
}

/** One decimal, because 28.4% and 28% are different answers at 6600 places. */
export function formatPercent(percent: number | null): string {
  return percent === null ? '—' : `${Math.round(percent * 10) / 10}%`;
}

/** No decimals, for the compact "(85%)" note beside a headline figure. */
export function formatShare(percent: number | null): string {
  return percent === null ? '—' : `${Math.round(percent)}%`;
}
