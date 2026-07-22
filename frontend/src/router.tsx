import { lazy, Suspense, type ReactNode } from 'react';
import { createBrowserRouter } from 'react-router-dom';
import { ROUTES } from '@/config/routes';
import { AppShell } from '@/components/layout/AppShell';
import { ProtectedRoute } from '@/components/auth/ProtectedRoute';
import { Spinner } from '@/components/ui';
// Entry screens load eagerly for instant first paint.
import SplashPage from '@/pages/SplashPage';
import LoginPage from '@/pages/LoginPage';

// Everything else is route-split so the initial bundle stays small and each
// screen streams in on demand (prefetched by the browser as links appear).
const HomePage = lazy(() => import('@/pages/HomePage'));
const ProfilePage = lazy(() => import('@/pages/ProfilePage'));
const MyQrPage = lazy(() => import('@/pages/MyQrPage'));
const EventsPage = lazy(() => import('@/pages/EventsPage'));
const EventDetailPage = lazy(() => import('@/pages/EventDetailPage'));
const EventEditPage = lazy(() => import('@/pages/EventEditPage'));
const HelpPage = lazy(() => import('@/pages/HelpPage'));
const MessPage = lazy(() => import('@/pages/MessPage'));
const HostelPage = lazy(() => import('@/pages/HostelPage'));
const AnnouncementsPage = lazy(() => import('@/pages/AnnouncementsPage'));
const PaymentsPage = lazy(() => import('@/pages/PaymentsPage'));
const MockCheckoutPage = lazy(() => import('@/pages/MockCheckoutPage'));
const ScannerPage = lazy(() => import('@/pages/ScannerPage'));
const ScanResultPage = lazy(() => import('@/pages/ScanResultPage'));
const AccessDeniedPage = lazy(() => import('@/pages/AccessDeniedPage'));
const UsersPage = lazy(() => import('@/pages/UsersPage'));
const AdminQueriesPage = lazy(() => import('@/pages/AdminQueriesPage'));
const AdminContactsPage = lazy(() => import('@/pages/AdminContactsPage'));
const AdminMessPage = lazy(() => import('@/pages/AdminMessPage'));
const AdminHostelPage = lazy(() => import('@/pages/AdminHostelPage'));
const AdminDashboardPage = lazy(() => import('@/pages/AdminDashboardPage'));
const AdminOverviewPage = lazy(() => import('@/pages/AdminOverviewPage'));
const AdminAnnouncementsPage = lazy(() => import('@/pages/AdminAnnouncementsPage'));
const AdminPaymentsPage = lazy(() => import('@/pages/AdminPaymentsPage'));
const PlaceholderPage = lazy(() => import('@/pages/PlaceholderPage'));

// Complete Your Profile pulls in the large country/state/city dataset — kept
// split so it never bloats the offline app shell.
const CompleteProfilePage = lazy(() => import('@/pages/CompleteProfilePage'));
const OnboardingLayout = lazy(() => import('@/pages/onboarding/OnboardingLayout'));

function Lazy({ children }: { children: ReactNode }) {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[60vh] items-center justify-center p-10">
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
  { path: ROUTES.accessDenied, element: <Lazy><AccessDeniedPage /></Lazy> },

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

  // Onboarding pipeline — authenticated students; renders the current journey
  // step (profile → stay → food → payment → events) and resumes at next_step.
  {
    path: ROUTES.onboarding,
    element: (
      <ProtectedRoute>
        <Lazy>
          <OnboardingLayout />
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
      { index: true, element: <Lazy><HomePage /></Lazy> },
      { path: 'profile', element: <Lazy><ProfilePage /></Lazy> },
      { path: 'qr', element: <Lazy><MyQrPage /></Lazy> },
      { path: 'events', element: <Lazy><EventsPage /></Lazy> },
      { path: 'events/:id', element: <Lazy><EventDetailPage /></Lazy> },
      { path: 'help', element: <Lazy><HelpPage /></Lazy> },
      { path: 'mess', element: <Lazy><MessPage /></Lazy> },
      { path: 'hostel', element: <Lazy><HostelPage /></Lazy> },
      { path: 'announcements', element: <Lazy><AnnouncementsPage /></Lazy> },
      { path: 'payments', element: <Lazy><PaymentsPage /></Lazy> },
    ],
  },

  // Simulated hosted checkout (mock gateway) — authenticated, outside the shell.
  {
    path: ROUTES.mockCheckout,
    element: (
      <ProtectedRoute>
        <Lazy><MockCheckoutPage /></Lazy>
      </ProtectedRoute>
    ),
  },

  // Staff scanning — organizer role or higher.
  {
    path: ROUTES.scanner,
    element: (
      <ProtectedRoute minRole="organizer">
        <Lazy><ScannerPage /></Lazy>
      </ProtectedRoute>
    ),
  },
  {
    path: ROUTES.scanResult,
    element: (
      <ProtectedRoute minRole="organizer">
        <Lazy><ScanResultPage /></Lazy>
      </ProtectedRoute>
    ),
  },

  // Admin user management — admin role or higher.
  {
    path: ROUTES.users,
    element: (
      <ProtectedRoute minRole="admin">
        <Lazy><UsersPage /></Lazy>
      </ProtectedRoute>
    ),
  },

  // Event management — organizer role or higher.
  {
    path: ROUTES.newEvent,
    element: (
      <ProtectedRoute minRole="organizer">
        <Lazy><EventEditPage /></Lazy>
      </ProtectedRoute>
    ),
  },
  {
    path: '/admin/events/:id/edit',
    element: (
      <ProtectedRoute minRole="organizer">
        <Lazy><EventEditPage /></Lazy>
      </ProtectedRoute>
    ),
  },

  // Query triage & contact directory management — admin role or higher.
  {
    path: ROUTES.manageQueries,
    element: (
      <ProtectedRoute minRole="admin">
        <Lazy><AdminQueriesPage /></Lazy>
      </ProtectedRoute>
    ),
  },
  {
    path: ROUTES.manageContacts,
    element: (
      <ProtectedRoute minRole="admin">
        <Lazy><AdminContactsPage /></Lazy>
      </ProtectedRoute>
    ),
  },

  // Mess management — organizer role or higher (eligibility section is admin+).
  {
    path: ROUTES.manageMess,
    element: (
      <ProtectedRoute minRole="organizer">
        <Lazy><AdminMessPage /></Lazy>
      </ProtectedRoute>
    ),
  },

  // Hostel allocation management — admin role or higher.
  {
    path: ROUTES.manageHostel,
    element: (
      <ProtectedRoute minRole="admin">
        <Lazy><AdminHostelPage /></Lazy>
      </ProtectedRoute>
    ),
  },

  // Live crowd dashboard — admin role or higher.
  {
    path: ROUTES.dashboard,
    element: (
      <ProtectedRoute minRole="admin">
        <Lazy><AdminDashboardPage /></Lazy>
      </ProtectedRoute>
    ),
  },

  // Announcements — admin role or higher.
  {
    path: ROUTES.manageAnnouncements,
    element: (
      <ProtectedRoute minRole="admin">
        <Lazy><AdminAnnouncementsPage /></Lazy>
      </ProtectedRoute>
    ),
  },

  // Operational overview — admin role or higher.
  {
    path: ROUTES.overview,
    element: (
      <ProtectedRoute minRole="admin">
        <Lazy><AdminOverviewPage /></Lazy>
      </ProtectedRoute>
    ),
  },

  // Payments admin (plans + reconciliation) — admin role or higher.
  {
    path: ROUTES.managePayments,
    element: (
      <ProtectedRoute minRole="admin">
        <Lazy><AdminPaymentsPage /></Lazy>
      </ProtectedRoute>
    ),
  },

  { path: '*', element: <Lazy><PlaceholderPage title="Not Found" /></Lazy> },
]);
