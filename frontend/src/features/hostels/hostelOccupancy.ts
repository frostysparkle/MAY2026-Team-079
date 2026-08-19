import type { Hostel, HostelStatisticsResponse } from '@/api/types';
import {
  deriveOccupancy,
  share,
  totalAllocated,
  type Occupancy,
  type OccupancyStatus,
} from '@/features/occupancy';

/**
 * The derived view of the hostel inventory that the dashboard reads.
 *
 * Occupancy is not a field on a hostel: the backend computes it from who is
 * allocated where, and reports it per block through `GET /hostels/{id}/statistics`.
 * This module joins the two into one row shape so the table, the cards, and the
 * summary figures all read the same numbers from the same place.
 *
 * The thresholds and colours themselves live in `features/occupancy`, shared with
 * the mess halls, which answer the same question about the same kind of figure.
 */

export type HostelCategory = 'men' | 'women' | 'other';

const CATEGORY_LABEL: Record<HostelCategory, string> = {
  men: 'Men',
  women: 'Women',
  other: 'Unspecified',
};

/**
 * Seeded blocks carry `category` ("men"/"women"); blocks created from the
 * dashboard form only set `gender` ("male"/"female"). Normalise both, because a
 * table cannot show the same thing under two different words.
 */
export function hostelCategory(hostel: Hostel): HostelCategory {
  const raw = (hostel.category ?? hostel.gender ?? '').toLowerCase();
  if (raw === 'men' || raw === 'male') return 'men';
  if (raw === 'women' || raw === 'female') return 'women';
  return 'other';
}

export function hostelCategoryLabel(category: HostelCategory): string {
  return CATEGORY_LABEL[category];
}

export interface HostelRow extends Occupancy {
  /** The record this row was derived from, for actions that need the whole thing. */
  hostel: Hostel;
  id: string;
  name: string;
  category: HostelCategory;
  categoryLabel: string;
  /** Allocated participants currently scanned in. */
  inside: number | null;
  /** Has at least one team member assigned. */
  staffed: boolean;
  /** At least one assigned member may scan entry/exit. */
  scanning: boolean;
}

export function buildHostelRows(
  hostels: Hostel[],
  stats: Record<string, HostelStatisticsResponse>,
): HostelRow[] {
  return hostels.map((hostel) => {
    const stat = stats[hostel.hostel_id];
    const team = hostel.hostel_team ?? [];
    // Prefer the capacity statistics reports, falling back to the record's own:
    // if the two ever disagree, the occupancy figures were computed against the
    // former, so using it keeps allocated/available/percent self-consistent.
    const category = hostelCategory(hostel);

    return {
      ...deriveOccupancy(stat?.capacity ?? hostel.capacity, stat ? stat.total_allocated : null),
      hostel,
      id: hostel.hostel_id,
      name: hostel.name,
      category,
      categoryLabel: hostelCategoryLabel(category),
      inside: stat ? stat.currently_inside : null,
      staffed: team.length > 0,
      scanning: team.some((member) => member.logging),
    };
  });
}

export interface HostelSummary {
  hostels: number;
  beds: number;
  /** Blocks and beds per category, and that as a share of every bed. */
  byCategory: {
    category: HostelCategory;
    label: string;
    hostels: number;
    beds: number;
    share: number | null;
  }[];
  /** Blocks with at least one team member assigned. */
  staffed: number;
  /** Total allocated across every block, or `null` when statistics are unreadable. */
  allocated: number | null;
  /** Beds still free, or `null` when the allocated total is unreadable. */
  available: number | null;
  percent: number | null;
}

/** The headline figures above the list. */
export function summariseHostels(rows: HostelRow[]): HostelSummary {
  const beds = rows.reduce((sum, r) => sum + r.capacity, 0);
  const allocated = totalAllocated(rows);

  // Only the categories actually present are reported, and every one of them is.
  // A fixed men's/women's pair would drop an "Unspecified" block out of a summary
  // that claims to account for every bed on campus — and an unspecified block is
  // precisely the one worth noticing, since allocation groups on that field.
  const categories: HostelCategory[] = ['men', 'women', 'other'];
  const byCategory = categories
    .map((category) => {
      const blocks = rows.filter((r) => r.category === category);
      const categoryBeds = blocks.reduce((sum, r) => sum + r.capacity, 0);
      return {
        category,
        label: hostelCategoryLabel(category),
        hostels: blocks.length,
        beds: categoryBeds,
        share: share(categoryBeds, beds),
      };
    })
    .filter((entry) => entry.hostels > 0);

  return {
    hostels: rows.length,
    beds,
    byCategory,
    staffed: rows.filter((r) => r.staffed).length,
    allocated,
    // Never negative: an over-allocated campus has no beds left, not "-4" of them.
    available: allocated === null ? null : Math.max(0, beds - allocated),
    percent: share(allocated, beds),
  };
}

export type { OccupancyStatus };
