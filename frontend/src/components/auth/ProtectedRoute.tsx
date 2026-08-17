import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { ROUTES } from '@/config/routes';
import { useAuthStore } from '@/stores/authStore';
import type { TokenType } from '@/api/types';

/**
 * Coarse client-side route guard, for gates that only need "is this a
 * participant / staff session" or "is this a super_admin". Entity-scoped
 * permissions (event_head, mess/hostel/workshop team membership) can't be
 * known from the session alone — those pages render unconditionally under
 * `requireTokenType="staff"` and do their own fetch-then-check-membership
 * dance. The backend enforces RBAC server-side regardless of what the client
 * shows.
 */
export function ProtectedRoute({
  requireTokenType,
  requireStaffRole,
  requireCompleteProfile,
  children,
}: {
  requireTokenType?: TokenType;
  requireStaffRole?: string | string[];
  /**
   * Bounce participants who have not finished Complete Your Profile. The
   * post-login redirect alone only covers the moment of signing in — the
   * session is persisted, so a reload, a bookmark, or a typed URL would
   * otherwise walk straight past it into the app with an empty profile.
   */
  requireCompleteProfile?: boolean;
  children: ReactNode;
}) {
  const session = useAuthStore((s) => s.session);

  if (!session) {
    return (
      <Navigate to={requireTokenType === 'staff' ? ROUTES.adminLogin : ROUTES.login} replace />
    );
  }
  if (requireTokenType && session.token_type !== requireTokenType) {
    return <Navigate to={ROUTES.accessDenied} replace />;
  }
  // `full_name` is the backend's own "profile is {}" signal: it comes back null
  // from /auth/login until PATCH /profile/complete has been accepted.
  if (
    requireCompleteProfile &&
    session.token_type === 'participant' &&
    (session.full_name === null || session.full_name === undefined)
  ) {
    return <Navigate to={ROUTES.completeProfile} replace />;
  }
  if (requireStaffRole && session.token_type === 'staff') {
    const allowed = Array.isArray(requireStaffRole) ? requireStaffRole : [requireStaffRole];
    if (!allowed.includes(session.role)) {
      return <Navigate to={ROUTES.accessDenied} replace />;
    }
  }
  return <>{children}</>;
}
