import { lazy, Suspense } from 'react';
import { createBrowserRouter } from 'react-router-dom';
import { ROUTES } from '@/config/routes';
import { AppShell } from '@/components/layout/AppShell';
import { ProtectedRoute } from '@/components/auth/ProtectedRoute';
import { Spinner } from '@/components/ui';
import SplashPage from '@/pages/SplashPage';
import LoginPage from '@/pages/LoginPage';
import HomePage from '@/pages/HomePage';
import ProfilePage from '@/pages/ProfilePage';
import MyQrPage from '@/pages/MyQrPage';
import ScannerPage from '@/pages/ScannerPage';
import ScanResultPage from '@/pages/ScanResultPage';
import AccessDeniedPage from '@/pages/AccessDeniedPage';
import UsersPage from '@/pages/UsersPage';
import EventsPage from '@/pages/EventsPage';
import EventDetailPage from '@/pages/EventDetailPage';
import EventEditPage from '@/pages/EventEditPage';
import HelpPage from '@/pages/HelpPage';
import MessPage from '@/pages/MessPage';
import HostelPage from '@/pages/HostelPage';
import AdminQueriesPage from '@/pages/AdminQueriesPage';
import AdminContactsPage from '@/pages/AdminContactsPage';
import AdminMessPage from '@/pages/AdminMessPage';
import AdminHostelPage from '@/pages/AdminHostelPage';
import PlaceholderPage from '@/pages/PlaceholderPage';

// Complete Your Profile pulls in the large country/state/city dataset. Lazy-load
// it so that dataset is split out of the main bundle — keeping the offline app
// shell (including My QR) small and precacheable by the service worker.
const CompleteProfilePage = lazy(() => import('@/pages/CompleteProfilePage'));

function Lazy({ children }: { children: React.ReactNode }) {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-full items-center justify-center p-10">
          <Spinner size={28} label="Loading" />
        </div>
      }
    >
      {children}
    </Suspense>
  );
}

/**
 * Route table. Public/auth routes are top-level; everything else is gated by
 * ProtectedRoute (auth, and a minimum role where relevant). Guards protect UI
 * only — the backend enforces RBAC server-side.
 */
export const router = createBrowserRouter([
  { path: ROUTES.splash, element: <SplashPage /> },
  { path: ROUTES.login, element: <LoginPage /> },
  { path: ROUTES.accessDenied, element: <AccessDeniedPage /> },

  {
    path: ROUTES.completeProfile,
    element: (
      <ProtectedRoute>
        <Lazy>
          <CompleteProfilePage />
        </Lazy>
      </ProtectedRoute>
    ),
  },

  // Participant area — any authenticated user, rendered inside the nav shell.
  {
    path: ROUTES.home,
    element: (
      <ProtectedRoute>
        <AppShell />
      </ProtectedRoute>
    ),
    children: [
      { index: true, element: <HomePage /> },
      { path: 'profile', element: <ProfilePage /> },
      { path: 'qr', element: <MyQrPage /> },
      { path: 'events', element: <EventsPage /> },
      { path: 'events/:id', element: <EventDetailPage /> },
      { path: 'help', element: <HelpPage /> },
      { path: 'mess', element: <MessPage /> },
      { path: 'hostel', element: <HostelPage /> },
    ],
  },

  // Staff scanning — organizer role or higher.
  {
    path: ROUTES.scanner,
    element: (
      <ProtectedRoute minRole="organizer">
        <ScannerPage />
      </ProtectedRoute>
    ),
  },
  {
    path: ROUTES.scanResult,
    element: (
      <ProtectedRoute minRole="organizer">
        <ScanResultPage />
      </ProtectedRoute>
    ),
  },

  // Admin user management — admin role or higher.
  {
    path: ROUTES.users,
    element: (
      <ProtectedRoute minRole="admin">
        <UsersPage />
      </ProtectedRoute>
    ),
  },

  // Event management — organizer role or higher.
  {
    path: ROUTES.newEvent,
    element: (
      <ProtectedRoute minRole="organizer">
        <EventEditPage />
      </ProtectedRoute>
    ),
  },
  {
    path: '/admin/events/:id/edit',
    element: (
      <ProtectedRoute minRole="organizer">
        <EventEditPage />
      </ProtectedRoute>
    ),
  },

  // Query triage & contact directory management — admin role or higher.
  {
    path: ROUTES.manageQueries,
    element: (
      <ProtectedRoute minRole="admin">
        <AdminQueriesPage />
      </ProtectedRoute>
    ),
  },
  {
    path: ROUTES.manageContacts,
    element: (
      <ProtectedRoute minRole="admin">
        <AdminContactsPage />
      </ProtectedRoute>
    ),
  },

  // Mess management — organizer role or higher (eligibility section is admin+).
  {
    path: ROUTES.manageMess,
    element: (
      <ProtectedRoute minRole="organizer">
        <AdminMessPage />
      </ProtectedRoute>
    ),
  },

  // Hostel allocation management — admin role or higher.
  {
    path: ROUTES.manageHostel,
    element: (
      <ProtectedRoute minRole="admin">
        <AdminHostelPage />
      </ProtectedRoute>
    ),
  },

  { path: '*', element: <PlaceholderPage title="Not Found" /> },
]);
