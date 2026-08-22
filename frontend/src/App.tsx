import { useEffect } from 'react';
import { RouterProvider } from 'react-router-dom';
import { router } from '@/router';
import { onUnauthorized } from '@/api/realApi';
import { useAuthStore } from '@/stores/authStore';
import { toast } from '@/stores/uiStore';
import { ToastHost } from '@/components/ui';
import { Announcer } from '@/components/a11y/Announcer';

export default function App() {
  /**
   * One place that reacts to the backend rejecting our token.
   *
   * A 401 on any request means the JWT is expired or invalid. The session is
   * persisted, so without this it stayed put: `ProtectedRoute` still saw a
   * session, kept the user inside the app, and every panel showed "Invalid
   * authentication credentials" with no way back to sign-in. Clearing it hands
   * the problem to the guard, which already redirects a participant to `/login`
   * and staff to `/admin/login`.
   *
   * Wired here rather than inside the API client so the request layer keeps
   * knowing nothing about sessions, and registered in an effect rather than at
   * module scope so it is torn down with the app in tests.
   */
  useEffect(() => {
    onUnauthorized(() => {
      // Only worth saying — and only worth clearing — if we thought we were
      // signed in. A 401 with no session is a failed sign-in attempt, which the
      // login form reports itself.
      if (useAuthStore.getState().session === null) return;
      useAuthStore.getState().clear();
      toast.warning('Your session has expired. Please sign in again.');
    });
    return () => onUnauthorized(null);
  }, []);

  return (
    <>
      <Announcer />
      <ToastHost />
      <RouterProvider router={router} />
    </>
  );
}
