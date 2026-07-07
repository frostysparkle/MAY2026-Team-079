/**
 * Auth/session store. Holds the signed-in participant and JWT, resolves the
 * current role, and persists across reloads. The role here is only ever what
 * the backend returned — the UI trusts server truth, never the splash choice.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Participant } from '@/api/types';
import type { Role } from '@/config/constants';
import { roleRank } from '@/config/constants';

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
  token: string | null;
  participant: Participant | null;
  setSession: (token: string, participant: Participant) => void;
  updateParticipant: (participant: Participant) => void;
  clear: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      token: null,
      participant: null,
      setSession: (token, participant) => {
        safeStorage.set(token);
        set({ token, participant });
      },
      updateParticipant: (participant) => set({ participant }),
      clear: () => {
        safeStorage.remove();
        set({ token: null, participant: null });
      },
    }),
    { name: 'pc_auth' },
  ),
);

/* -------- selectors / helpers (kept outside components for reuse) -------- */

export function isAuthenticated(): boolean {
  return useAuthStore.getState().token !== null;
}

export function currentRole(): Role | null {
  return useAuthStore.getState().participant?.role ?? null;
}

/** True when the current user's role is at least `min` in the hierarchy. */
export function hasRoleAtLeast(min: Role): boolean {
  const role = currentRole();
  return role !== null && roleRank(role) >= roleRank(min);
}
