import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { ROUTES } from '@/config/routes';
import { useAuthStore } from '@/stores/authStore';
import { roleRank, type Role } from '@/config/constants';

/**
 * Client-side route guard. Gates UI only — the backend enforces RBAC server-side
 * regardless of what the client shows. Unauthenticated users are sent to login;
 * authenticated users lacking the required role get the Access Denied page (no
 * protected content renders behind it).
 */
export function ProtectedRoute({ minRole, children }: { minRole?: Role; children: ReactNode }) {
  const participant = useAuthStore((s) => s.participant);

  if (!participant) {
    return <Navigate to={ROUTES.login} replace />;
  }
  if (minRole && roleRank(participant.role) < roleRank(minRole)) {
    return <Navigate to={ROUTES.accessDenied} replace />;
  }
  return <>{children}</>;
}
