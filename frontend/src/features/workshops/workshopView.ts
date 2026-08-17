import type { PublicWorkshopRecord, Workshop } from '@/api/types';
import {
  parseSlotId,
  workshopDayLabel,
  type WorkshopShift,
  type WorkshopSlot,
} from './workshopSlot';

/**
 * One shape the workshop pages render, whether the record came from the public
 * programme (`GET /workshops/public`) or the authenticated list. Nothing below
 * the view layer branches on where a workshop came from.
 */

/** Fallback artwork when a workshop has no flyer of its own. */
export const WORKSHOP_COVER = '/images/events/Technicals.avif';

export interface WorkshopView {
  id: string;
  name: string;
  venue: string;
  capacity: number;
  instructions: string;
  /** Thumbnail for the grid. */
  poster: string;
  /** Full-resolution flyer for the detail page. */
  posterFull: string;
  slot: WorkshopSlot;
  /** `11 June`, or undefined when the slot id carries no date. */
  dayLabel?: string;
  /** Seats left, when the record reports a registration count. */
  seatsLeft?: number;
  /** Only the authenticated list carries the full record. */
  workshop?: Workshop;
}

/**
 * Flyer paths are derived from the workshop id by convention rather than stored
 * on the record: `workshop-12` → `/images/workshops/workshop-12.avif` and
 * `workshop-12-full.avif`. The backend `Workshop` schema has no poster column,
 * and the 57 flyers already shipped in `public/images/workshops/` are named this
 * way, so a workshop whose id matches keeps its artwork with nothing stored.
 *
 * A workshop with no matching file falls back to `WORKSHOP_COVER` at render
 * time via the poster card's `onError`.
 */
export function workshopPosterPaths(workshopId: string): { poster: string; posterFull: string } {
  const slug = workshopId.trim();
  return {
    poster: `/images/workshops/${slug}.avif`,
    posterFull: `/images/workshops/${slug}-full.avif`,
  };
}

function toView(record: PublicWorkshopRecord, workshop?: Workshop): WorkshopView {
  const slot = parseSlotId(record.slot_id);
  const { poster, posterFull } = workshopPosterPaths(record.workshop_id);
  const seatsLeft =
    typeof record.registration_count === 'number'
      ? Math.max(0, record.capacity - record.registration_count)
      : undefined;

  return {
    id: record.workshop_id,
    name: record.name,
    venue: record.venue,
    capacity: record.capacity,
    instructions: record.instructions ?? '',
    poster,
    posterFull,
    slot,
    dayLabel: slot.date ? workshopDayLabel(slot.date) : undefined,
    seatsLeft,
    workshop,
  };
}

/** A record from the public programme. */
export function publicWorkshopView(record: PublicWorkshopRecord): WorkshopView {
  return toView(record);
}

/** A record from the authenticated list, which can be registered against. */
export function workshopView(workshop: Workshop): WorkshopView {
  return toView(workshop, workshop);
}

/**
 * Programme order: by day, then morning before afternoon, then by id — so the
 * grid reads chronologically rather than in insertion order.
 */
export function sortWorkshops(views: WorkshopView[]): WorkshopView[] {
  const shiftRank: Record<WorkshopShift, number> = { morning: 0, afternoon: 1 };
  return [...views].sort((a, b) => {
    // Undated workshops sort last rather than jumping to the front.
    const dayA = a.slot.date ?? '￿';
    const dayB = b.slot.date ?? '￿';
    if (dayA !== dayB) return dayA.localeCompare(dayB);

    const rankA = a.slot.shift ? shiftRank[a.slot.shift] : 2;
    const rankB = b.slot.shift ? shiftRank[b.slot.shift] : 2;
    if (rankA !== rankB) return rankA - rankB;

    return a.id.localeCompare(b.id, undefined, { numeric: true });
  });
}

export interface WorkshopDay {
  /** ISO `YYYY-MM-DD`. */
  date: string;
  /** `11 June`. */
  label: string;
  count: number;
}

/**
 * Every day that actually has a workshop, derived from the programme.
 *
 * Deriving rather than hardcoding means a date can never exist in the data
 * without a way to filter to it, whatever the organisers change the dates to.
 */
export function workshopDays(views: WorkshopView[]): WorkshopDay[] {
  const counts = new Map<string, number>();
  for (const view of views) {
    if (!view.slot.date) continue;
    counts.set(view.slot.date, (counts.get(view.slot.date) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, count]) => ({ date, label: workshopDayLabel(date), count }));
}
