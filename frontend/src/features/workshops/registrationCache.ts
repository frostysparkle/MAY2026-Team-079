/**
 * This participant's workshop bookings, keyed by the slot each one occupies.
 *
 * A workshop's slot is exclusive: `POST /workshops/{id}/register` refuses a
 * second booking in a slot the participant already holds with
 * `400 "Already registered for another workshop in this time slot"`. The
 * catalogue has to reflect that before the tap, which means knowing what is
 * already held.
 *
 * This used to be a bare module-scope `Map` written only on a successful
 * registration, on the stated grounds that there was "no
 * `GET /workshops/my_registrations` endpoint to ask the server". There is — it
 * has been wired in `api/realApi.ts` all along and `MyRegistrationsPage` already
 * reads it — so the clash hint silently disappeared on every reload and never
 * knew about a booking made on another device. It is now seeded from that
 * endpoint and kept in a store so the grid re-renders when the answer arrives.
 *
 * The server's 400 is still the real gate. This exists to stop a participant
 * being sent down a path that cannot work.
 */
import { create } from 'zustand';
import { api, ApiClientError } from '@/api';
import type { MyWorkshopRegistration } from '@/api/types';

/** `own` = this exact workshop; `conflict` = a different one in the same slot. */
export type SlotStatus = 'own' | 'conflict' | 'none';

export type BookingsStatus = 'idle' | 'loading' | 'ready' | 'error';

interface WorkshopBookingsState {
  /**
   * slot_id → the workshop held in it. `null` when the workshop was deleted
   * after booking: `GET /workshops/my_registrations` still reports the slot, and
   * the backend still counts it as occupied, so the slot must still read as
   * taken even though there is no workshop left to name.
   */
  bySlot: Record<string, string | null>;
  status: BookingsStatus;
  /** Why the seed failed, for callers that want to say so. Never blocking. */
  error: string | null;
  /** Replace the map from a server response. */
  seed: (registrations: readonly MyWorkshopRegistration[]) => void;
  /** Record a booking this session made, without waiting for a re-read. */
  remember: (slotId: string, workshopId: string) => void;
  /** Forget everything — used on sign-out so the next participant starts clean. */
  reset: () => void;
  setStatus: (status: BookingsStatus, error?: string | null) => void;
}

export const useWorkshopBookingsStore = create<WorkshopBookingsState>((set) => ({
  bySlot: {},
  status: 'idle',
  error: null,
  seed: (registrations) =>
    set({
      bySlot: Object.fromEntries(
        registrations
          .filter((entry) => typeof entry.slot_id === 'string' && entry.slot_id !== '')
          .map((entry) => [entry.slot_id, entry.workshop_id]),
      ),
      status: 'ready',
      error: null,
    }),
  remember: (slotId, workshopId) =>
    set((state) => ({ bySlot: { ...state.bySlot, [slotId]: workshopId } })),
  reset: () => set({ bySlot: {}, status: 'idle', error: null }),
  setStatus: (status, error = null) => set({ status, error }),
}));

/**
 * Fetch the bookings once per session.
 *
 * Participant-only: `GET /workshops/my_registrations` sits behind
 * `get_current_participant`, so calling it with a staff token is a guaranteed
 * failure. A staff member browsing the catalogue simply has no bookings, which
 * is the correct answer rather than an error to report.
 */
export async function loadMyWorkshopBookings(options: { force?: boolean } = {}): Promise<void> {
  const store = useWorkshopBookingsStore.getState();
  if (!options.force && (store.status === 'loading' || store.status === 'ready')) return;

  store.setStatus('loading');
  try {
    const registrations = await api.myWorkshopRegistrations();
    useWorkshopBookingsStore.getState().seed(registrations);
  } catch (e) {
    // Deliberately soft. A failed read costs a participant the grey-out hint, not
    // the ability to book — the server still refuses a clashing registration.
    useWorkshopBookingsStore
      .getState()
      .setStatus(
        'error',
        e instanceof ApiClientError ? e.message : 'Could not read your workshop bookings.',
      );
  }
}

/** Record a booking that just succeeded, so the catalogue updates immediately. */
export function rememberWorkshopRegistration(slotId: string, workshopId: string): void {
  useWorkshopBookingsStore.getState().remember(slotId, workshopId);
}

/** Drop the cache — called when a session ends. */
export function resetWorkshopBookings(): void {
  useWorkshopBookingsStore.getState().reset();
}

/**
 * Compare one workshop against what is already held in its slot.
 *
 * Pure, and exported for tests and for callers that already hold the map.
 */
export function readSlotStatus(
  bySlot: Readonly<Record<string, string | null>>,
  slotId: string,
  workshopId: string,
): SlotStatus {
  if (!slotId || !(slotId in bySlot)) return 'none';
  return bySlot[slotId] === workshopId ? 'own' : 'conflict';
}
