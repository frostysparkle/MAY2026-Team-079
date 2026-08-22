/**
 * Auth/session store. Holds the signed-in participant or staff session and
 * persists across reloads. The two token types carry different response
 * shapes and different downstream permissions — the UI trusts server truth,
 * never a cached role hierarchy.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ParticipantLoginResponse, StaffLoginResponse } from '@/api/types';
import { resetWorkshopBookings } from '@/features/workshops/registrationCache';

export type ParticipantSession = ParticipantLoginResponse;
export type StaffSession = StaffLoginResponse;
export type Session = ParticipantSession | StaffSession;

/** Kept in sync with a plain localStorage key so the real API client can read it. */
const TOKEN_KEY = 'pc_token';

/** Storage may be unavailable (private mode, tests). Fail quietly if so. */
const safeStorage = {
  set(value: string) {
    try {
      localStorage.setItem(TOKEN_KEY, value);
    } catch {
      /* ignore */
    }
  },
  remove() {
    try {
      localStorage.removeItem(TOKEN_KEY);
    } catch {
      /* ignore */
    }
  },
};

interface AuthState {
  session: Session | null;
  setParticipantSession: (res: ParticipantLoginResponse) => void;
  setStaffSession: (res: StaffLoginResponse) => void;
  updateParticipantProfile: (patch: Partial<ParticipantLoginResponse>) => void;
  /** For the rotated token returned by /auth/password/change. */
  setToken: (token: string) => void;
  clear: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      session: null,
      setParticipantSession: (res) => {
        safeStorage.set(res.access_token);
        set({ session: res });
      },
      setStaffSession: (res) => {
        safeStorage.set(res.access_token);
        set({ session: res });
      },
      updateParticipantProfile: (patch) => {
        const current = get().session;
        if (!current || current.token_type !== 'participant') return;
        set({ session: { ...current, ...patch } });
      },
      setToken: (token) => {
        safeStorage.set(token);
        const current = get().session;
        if (current) set({ session: { ...current, access_token: token } });
      },
      clear: () => {
        safeStorage.remove();
        set({ session: null });
        // Per-session caches keyed to *this* participant have to go with the
        // session, or the next person to sign in on this device inherits their
        // workshop clashes. Done here rather than at the six sign-out buttons, so
        // a seventh cannot forget.
        resetWorkshopBookings();
      },
    }),
    { name: 'pc_auth_v2' },
  ),
);

/* -------- selectors / helpers (kept outside components for reuse) -------- */

export function isAuthenticated(): boolean {
  return useAuthStore.getState().session !== null;
}

export function isParticipant(): boolean {
  return useAuthStore.getState().session?.token_type === 'participant';
}

export function isStaff(): boolean {
  return useAuthStore.getState().session?.token_type === 'staff';
}

export function currentParticipant(): ParticipantSession | null {
  const s = useAuthStore.getState().session;
  return s && s.token_type === 'participant' ? s : null;
}

export function currentStaff(): StaffSession | null {
  const s = useAuthStore.getState().session;
  return s && s.token_type === 'staff' ? s : null;
}

export function isSuperAdmin(): boolean {
  return currentStaff()?.role === 'super_admin';
}

export function isUhc(): boolean {
  return currentStaff()?.department === 'uhc';
}

export function isDomainAdminFor(eventType: string): boolean {
  const staff = currentStaff();
  return staff !== null && staff.department === eventType;
}

/**
 * UHC house derivation mirrors the backend's fragile convention
 * (`email.split('-')[0].lower()`). Returns null when the email has no
 * hyphen — same "silently sees nobody" trap the backend has, surfaced
 * to the UI as an explicit warning instead of a silent empty list.
 */
export function uhcHouse(): string | null {
  const staff = currentStaff();
  if (!staff || !staff.email.includes('-')) return null;
  return staff.email.split('-')[0].toLowerCase();
}

export function isProfileComplete(): boolean {
  return currentParticipant()?.full_name !== null && currentParticipant()?.full_name !== undefined;
}
