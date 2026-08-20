import { Users } from 'lucide-react';
import type { EventCapacityCountsResponse } from '@/api/types';
import { ProgressBar, StatusBadge } from '@/components/ui';
import { ADMITTED_NOTE, readEventCrowd } from './eventCapacity';

/**
 * "How busy is this right now" on the participant's event page — Story 3.3.
 *
 * An event whose organiser published no capacity still gets the card, with the
 * raw counts and no status: "218 registered · 96 checked in today" is useful on
 * its own, and inventing a fullness verdict with nothing to divide by is not.
 */
export function EventCrowdCard({
  counts,
  capacity,
}: {
  counts: EventCapacityCountsResponse;
  /** The organiser's published limit, or `undefined` when they set none. */
  capacity: number | undefined;
}) {
  const crowd = readEventCrowd(counts, capacity);
  const { venue, demand } = crowd;

  return (
    <section
      aria-label="How busy this event is"
      className="flex flex-col gap-2.5 rounded-2xl bg-surface p-4 shadow-card ring-1 ring-line"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted">
          <Users size={13} aria-hidden /> How busy it is
        </p>
        {venue?.label && <StatusBadge tone={venue.tone}>{venue.label}</StatusBadge>}
      </div>

      <p className="text-sm font-semibold text-ink">
        <span className="tabular-nums">{crowd.attendedToday.toLocaleString()}</span> in the venue
        today
        {venue && <span className="font-normal text-muted"> · {venue.summary.toLowerCase()}</span>}
      </p>

      {venue !== null && venue.admitted !== null && (
        <ProgressBar
          value={venue.admitted}
          max={venue.capacity}
          tone={venue.barTone}
          label="Entries used today"
        />
      )}

      <p className="text-[11px] text-muted">
        <span className="tabular-nums">{crowd.registered.toLocaleString()}</span> registered
        {demand?.atCapacity
          ? ' — registrations have reached the published capacity'
          : demand
            ? ` of ${demand.capacity.toLocaleString()} places`
            : ''}
        {' · '}
        {ADMITTED_NOTE}
      </p>
    </section>
  );
}
