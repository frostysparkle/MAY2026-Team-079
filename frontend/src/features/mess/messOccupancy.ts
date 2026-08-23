import type { Mess, MessStatisticsResponse } from '@/api/types';
import type { BadgeTone } from '@/components/ui';
import {
  messCuisineLabel,
  messCuisineOf,
  messDietOf,
  messPreferenceTypeLabel,
} from '@/config/constants';
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
 * A hall's `type` (e.g. `"north_indian__veg"`, `"jain"`) is one stored field,
 * split here into its two axes for display — dietary designation (`diet`, the
 * only thing `POST /mess/allocate` groups on) and regional cuisine (`cuisine`,
 * presentation only). Collapsing them into one badge would suggest a hall's menu
 * decides who eats there, which is not how allocation works.
 */

export type MessDiet = 'veg' | 'non_veg' | 'jain' | 'other';

const DIET_LABEL: Record<MessDiet, string> = {
  veg: 'Veg',
  non_veg: 'Non-Veg',
  jain: 'Jain',
  other: 'Unspecified',
};

/** The dietary badge's tone. Distinct hues, since this is the primary axis. */
const DIET_TONE: Record<MessDiet, BadgeTone> = {
  veg: 'success',
  non_veg: 'danger',
  jain: 'info',
  other: 'neutral',
};

/**
 * The dietary axis of a hall's stored `type`. A hall whose `type` is outside the
 * backend's known set is filed as `other`: it is real, and it must stay visible,
 * but it can never be allocated to, which the "Unspecified" label is meant to
 * prompt a question about.
 */
export function messDiet(mess: Mess): MessDiet {
  const diet = messDietOf((mess.type ?? '').toLowerCase());
  if (diet === 'veg' || diet === 'non_veg' || diet === 'jain') return diet;
  return 'other';
}

export function messDietLabel(diet: MessDiet): string {
  return DIET_LABEL[diet];
}

export function messDietTone(diet: MessDiet): BadgeTone {
  return DIET_TONE[diet];
}

export interface MessRow extends Occupancy {
  /** The record this row was derived from, for actions that need the whole thing. */
  mess: Mess;
  id: string;
  name: string;
  /** The full stored `type`, e.g. `"north_indian__veg"` — for the create/edit form. */
  type: string;
  /** Human label for the full `type`, e.g. "North Indian · Veg". */
  typeLabel: string;
  diet: MessDiet;
  dietLabel: string;
  dietTone: BadgeTone;
  /** The regional cuisine axis of `type`, or `null` for `jain` (no region). */
  cuisine: string | null;
  /** `cuisine` as a label, for display and for matching a search. */
  cuisineLabel: string | null;
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
    const type = (mess.type ?? '').toLowerCase();
    const diet = messDiet(mess);
    const cuisine = messCuisineOf(type);

    return {
      // Prefer the capacity statistics reports, falling back to the record's own:
      // if the two ever disagree, the occupancy figures were computed against the
      // former, so using it keeps allocated/available/percent self-consistent.
      ...deriveOccupancy(stat?.capacity ?? mess.capacity, stat ? stat.total_allocated : null),
      mess,
      id: mess.mess_id,
      name: mess.name,
      type: mess.type,
      typeLabel: messPreferenceTypeLabel(mess.type ?? ''),
      diet,
      dietLabel: messDietLabel(diet),
      dietTone: messDietTone(diet),
      cuisine,
      cuisineLabel: cuisine ? messCuisineLabel(cuisine) : null,
      staffed: team.length > 0,
      scanning: team.some((member) => member.logging),
    };
  });
}

export interface MessSummary {
  halls: number;
  seats: number;
  /**
   * Seats and real occupancy per dietary designation.
   *
   * `percent` is allocated-within-this-designation, never the designation's share
   * of total capacity. The summary used to report the latter beside a progress
   * bar, so an entirely empty 450-seat veg hall read as "38%".
   */
  byType: {
    type: MessDiet;
    label: string;
    halls: number;
    seats: number;
    allocated: number | null;
    percent: number | null;
  }[];
  /** Halls with at least one team member assigned. */
  staffed: number;
  /**
   * Halls with at least one diner allocated, or `null` when statistics are
   * unreadable. How many halls are in use is a different question from how many
   * exist, and the table underneath already answers the second one.
   */
  occupied: number | null;
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
  const diets: MessDiet[] = ['veg', 'non_veg', 'jain', 'other'];
  const byType = diets
    .map((diet) => {
      const halls = rows.filter((row) => row.diet === diet);
      const typeSeats = halls.reduce((sum, row) => sum + row.capacity, 0);
      const typeAllocated = totalAllocated(halls);
      return {
        type: diet,
        label: messDietLabel(diet),
        halls: halls.length,
        seats: typeSeats,
        allocated: typeAllocated,
        percent: share(typeAllocated, typeSeats),
      };
    })
    .filter((entry) => entry.halls > 0);

  return {
    halls: rows.length,
    seats,
    byType,
    staffed: rows.filter((row) => row.staffed).length,
    // Unreadable statistics must not read as "no hall is in use".
    occupied: allocated === null ? null : rows.filter((row) => (row.allocated ?? 0) > 0).length,
    allocated,
    // Never negative: an over-allocated campus has no seats left, not "-4" of them.
    available: allocated === null ? null : Math.max(0, seats - allocated),
    percent: share(allocated, seats),
  };
}

export type { OccupancyStatus };
