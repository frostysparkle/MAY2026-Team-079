import type { Mess, MessStatisticsResponse } from '@/api/types';
import type { BadgeTone } from '@/components/ui';
import { messCuisineLabel } from '@/config/constants';
import {
  deriveOccupancy,
  share,
  totalAllocated,
  type Occupancy,
  type OccupancyStatus,
} from '@/features/occupancy';

/**
 * The derived view of the mess inventory that the dashboard reads.
 *
 * Occupancy is not a field on a hall: the backend computes it from who is
 * allocated where, and reports it per hall through `GET /mess/{id}/statistics`.
 * This module joins the two into one row shape so the table, the cards, and the
 * summary figures all read the same numbers from the same place.
 *
 * A hall is described on two independent axes, and the table keeps them in
 * separate columns for that reason:
 *
 *   - `preference` — veg / non_veg / jain. The dietary designation, and the only
 *     field `POST /mess/allocate` groups on.
 *   - `cuisines`   — north_indian / south_indian, possibly both. Presentation
 *     only; nothing allocates on it.
 *
 * Collapsing them into one badge would suggest a hall's menu decides who eats
 * there, which is not how allocation works.
 */

export type MessType = 'veg' | 'non_veg' | 'jain' | 'other';

const TYPE_LABEL: Record<MessType, string> = {
  veg: 'Veg',
  non_veg: 'Non-Veg',
  jain: 'Jain',
  other: 'Unspecified',
};

/** The dietary badge's tone. Distinct hues, since this is the primary axis. */
const TYPE_TONE: Record<MessType, BadgeTone> = {
  veg: 'success',
  non_veg: 'danger',
  jain: 'info',
  other: 'neutral',
};

/**
 * Normalise the stored `preference`. A hall whose value is outside the three
 * known ones is filed as `other`: it is real, and it must stay visible, but it
 * can never be allocated to, which the "Unspecified" label is meant to prompt a
 * question about.
 */
export function messType(mess: Mess): MessType {
  const raw = (mess.preference ?? '').toLowerCase();
  if (raw === 'veg' || raw === 'non_veg' || raw === 'jain') return raw;
  return 'other';
}

export function messTypeLabel(type: MessType): string {
  return TYPE_LABEL[type];
}

export function messTypeTone(type: MessType): BadgeTone {
  return TYPE_TONE[type];
}

export interface MessRow extends Occupancy {
  /** The record this row was derived from, for actions that need the whole thing. */
  mess: Mess;
  id: string;
  name: string;
  type: MessType;
  typeLabel: string;
  typeTone: BadgeTone;
  /** Stored cuisine keys, e.g. `['north_indian']`. Empty when none was declared. */
  cuisines: string[];
  /** Those keys as labels, for display and for matching a search. */
  cuisineLabels: string[];
  /** Has at least one team member assigned. */
  staffed: boolean;
  /** At least one assigned member may scan meals. */
  scanning: boolean;
}

export function buildMessRows(
  halls: Mess[],
  stats: Record<string, MessStatisticsResponse>,
): MessRow[] {
  return halls.map((mess) => {
    const stat = stats[mess.mess_id];
    const team = mess.mess_team ?? [];
    const type = messType(mess);
    const cuisines = mess.cuisines ?? [];

    return {
      // Prefer the capacity statistics reports, falling back to the record's own:
      // if the two ever disagree, the occupancy figures were computed against the
      // former, so using it keeps allocated/available/percent self-consistent.
      ...deriveOccupancy(stat?.capacity ?? mess.capacity, stat ? stat.total_allocated : null),
      mess,
      id: mess.mess_id,
      name: mess.name,
      type,
      typeLabel: messTypeLabel(type),
      typeTone: messTypeTone(type),
      cuisines,
      cuisineLabels: cuisines.map(messCuisineLabel),
      staffed: team.length > 0,
      scanning: team.some((member) => member.logging),
    };
  });
}

export interface MessSummary {
  halls: number;
  seats: number;
  /** Seats per dietary designation, and that as a share of every seat. */
  byType: { type: MessType; label: string; halls: number; seats: number; share: number | null }[];
  /** Halls with at least one team member assigned. */
  staffed: number;
  /** Total allocated across every hall, or `null` when statistics are unreadable. */
  allocated: number | null;
  /** Seats still free, or `null` when the allocated total is unreadable. */
  available: number | null;
  percent: number | null;
}

/** The headline figures above the list. */
export function summariseMess(rows: MessRow[]): MessSummary {
  const seats = rows.reduce((sum, row) => sum + row.capacity, 0);
  const allocated = totalAllocated(rows);

  // Only the designations actually present are reported. A "Jain seats: 0" card
  // for a campus with no jain hall is noise, and one appears the moment a hall
  // is created — the figures follow the data rather than a fixed layout.
  const types: MessType[] = ['veg', 'non_veg', 'jain', 'other'];
  const byType = types
    .map((type) => {
      const halls = rows.filter((row) => row.type === type);
      const typeSeats = halls.reduce((sum, row) => sum + row.capacity, 0);
      return {
        type,
        label: messTypeLabel(type),
        halls: halls.length,
        seats: typeSeats,
        share: share(typeSeats, seats),
      };
    })
    .filter((entry) => entry.halls > 0);

  return {
    halls: rows.length,
    seats,
    byType,
    staffed: rows.filter((row) => row.staffed).length,
    allocated,
    // Never negative: an over-allocated campus has no seats left, not "-4" of them.
    available: allocated === null ? null : Math.max(0, seats - allocated),
    percent: share(allocated, seats),
  };
}

export type { OccupancyStatus };
