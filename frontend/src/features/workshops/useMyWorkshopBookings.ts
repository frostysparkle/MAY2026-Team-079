import { useEffect } from 'react';
import { isParticipant } from '@/stores/authStore';
import {
  loadMyWorkshopBookings,
  readSlotStatus,
  useWorkshopBookingsStore,
  type BookingsStatus,
  type SlotStatus,
} from './registrationCache';

export interface MyWorkshopBookings {
  /** How the read went. `error` still yields a usable (empty) map. */
  status: BookingsStatus;
  error: string | null;
  /**
   * True once the answer is in. Until then the catalogue must not claim a
   * workshop is free of clashes — it just does not know yet.
   */
  ready: boolean;
  /** How many slots this participant already holds. */
  count: number;
  /** `own` | `conflict` | `none` for one workshop in one slot. */
  slotStatus: (slotId: string, workshopId: string) => SlotStatus;
}

/**
 * This participant's held slots, for the clash rule in the workshop catalogue.
 *
 * Reads through the shared store rather than fetching per screen, so the list
 * page's many cards and the detail page agree, and a booking made on the detail
 * page is visible on the list without a round trip.
 *
 * Staff get an empty, immediately-ready map: the endpoint behind this is
 * participant-only, and a staff member has no bookings to clash with.
 */
export function useMyWorkshopBookings(): MyWorkshopBookings {
  const bySlot = useWorkshopBookingsStore((s) => s.bySlot);
  const status = useWorkshopBookingsStore((s) => s.status);
  const error = useWorkshopBookingsStore((s) => s.error);
  const participant = isParticipant();

  useEffect(() => {
    if (!participant) return;
    void loadMyWorkshopBookings();
  }, [participant]);

  return {
    status: participant ? status : 'ready',
    error: participant ? error : null,
    // An errored read is "as ready as it will get": the map is empty and the
    // server remains the gate, so the UI should stop waiting rather than hedge
    // forever.
    ready: !participant || status === 'ready' || status === 'error',
    count: Object.keys(bySlot).length,
    slotStatus: (slotId, workshopId) =>
      participant ? readSlotStatus(bySlot, slotId, workshopId) : 'none',
  };
}
