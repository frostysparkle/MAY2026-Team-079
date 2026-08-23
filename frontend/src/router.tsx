import { lazy, Suspense } from 'react';
import { createBrowserRouter, Navigate, Outlet, type RouteObject } from 'react-router-dom';
import {
  ROUTES,
  staffSupportPath,
  supportPath,
  type StaffSupportTab,
  type SupportTab,
} from '@/config/routes';
import { AppShell } from '@/components/layout/AppShell';
import { StaffShell } from '@/components/layout/StaffShell';
import { ProtectedRoute } from '@/components/auth/ProtectedRoute';
import { Spinner } from '@/components/ui';

import LandingPage from '@/pages/public/LandingPage';
import LoginPage from '@/pages/LoginPage';
import AdminLoginPage from '@/pages/AdminLoginPage';
import RegisterPage from '@/pages/RegisterPage';
import ForgotPasswordPage from '@/pages/ForgotPasswordPage';
import ResetPasswordPage from '@/pages/ResetPasswordPage';
import AccessDeniedPage from '@/pages/AccessDeniedPage';
import NotFoundPage from '@/pages/NotFoundPage';
import ErrorPage from '@/pages/ErrorPage';

import DashboardPage from '@/pages/DashboardPage';
import ProfilePage from '@/pages/ProfilePage';
import ChangePasswordPage from '@/pages/ChangePasswordPage';
import MyQrPage from '@/pages/MyQrPage';
import AccommodationPage from '@/pages/stay/AccommodationPage';
import StayPaymentPage from '@/pages/stay/StayPaymentPage';
import SupportPage from '@/pages/support/SupportPage';

import EventsListPage from '@/pages/events/EventsListPage';
import EventDetailPage from '@/pages/events/EventDetailPage';
import MyRegistrationsPage from '@/pages/events/MyRegistrationsPage';
import FestSchedulePage from '@/pages/FestSchedulePage';
import WorkshopsListPage from '@/pages/workshops/WorkshopsListPage';
import WorkshopDetailPage from '@/pages/workshops/WorkshopDetailPage';

import MessScannerPage from '@/pages/scan/MessScannerPage';
import MessMenuPage from '@/pages/staff/MessMenuPage';
import StaffSupportPage from '@/pages/staff/StaffSupportPage';
import HostelScannerPage from '@/pages/scan/HostelScannerPage';
import EventScannerPage from '@/pages/scan/EventScannerPage';
import WorkshopScannerPage from '@/pages/scan/WorkshopScannerPage';

import StaffHomePage from '@/pages/staff/StaffHomePage';
import WorkshopManagePage from '@/pages/staff/WorkshopManagePage';
import EventParticipationPage from '@/pages/staff/EventParticipationPage';
import EventTeamsPage from '@/pages/staff/EventTeamsPage';

import AdminOverviewPage from '@/pages/staff/admin/AdminOverviewPage';
import AdminEventsPage from '@/pages/staff/admin/AdminEventsPage';
import AdminEventDetailPage from '@/pages/staff/admin/AdminEventDetailPage';
import AdminEventEditorPage from '@/pages/staff/admin/AdminEventEditorPage';
import AdminWorkshopsPage from '@/pages/staff/admin/AdminWorkshopsPage';
import AdminWorkshopEditorPage from '@/pages/staff/admin/AdminWorkshopEditorPage';
import AdminMessPage from '@/pages/staff/admin/AdminMessPage';
import AdminHostelsPage from '@/pages/staff/admin/AdminHostelsPage';
import AdminBackendTeamsPage from '@/pages/staff/admin/AdminBackendTeamsPage';
import AdminParticipantsPage from '@/pages/staff/admin/AdminParticipantsPage';
import AuditLogsPage from '@/pages/staff/admin/AuditLogsPage';
import EntityLogsPage from '@/pages/staff/admin/EntityLogsPage';

// Complete Your Profile pulls in the large country/state/city dataset. Lazy-load
// it so that dataset is split out of the main bundle — keeping the offline app
// shell (including My QR) small and precacheable by the service worker.
const CompleteProfilePage = lazy(() => import('@/pages/CompleteProfilePage'));

// The public brochure pages carry the full static festival catalogue — 53 event
// records with prizes/timelines/FAQs, 57 workshop flyers, 129 schedule rows.
// Lazy-load them so none of that ships in the offline app shell the service
// worker precaches; a signed-in participant never opens these routes.
const PublicEventsPage = lazy(() => import('@/pages/public/PublicEventsPage'));
const PublicEventDetailPage = lazy(() => import('@/pages/public/PublicEventDetailPage'));
const PublicSchedulePage = lazy(() => import('@/pages/public/PublicSchedulePage'));
const PublicWorkshopsPage = lazy(() => import('@/pages/public/PublicWorkshopsPage'));
const PublicWorkshopDetailPage = lazy(() => import('@/pages/public/PublicWorkshopDetailPage'));
const PublicSponsorsPage = lazy(() => import('@/pages/public/PublicSponsorsPage'));

/**
 * `/app/help`, `/app/report-issue` and `/app/queries` → the tab of
 * `/app/support` that now carries each of them.
 *
 * Declared as child paths of the participant block, so they stay inside the same
 * `ProtectedRoute` guard the originals were behind: a signed-out visitor
 * following an old bookmark is sent to sign in, exactly as before, rather than
 * being redirected to a route that then bounces them.
 */
const SUPPORT_REDIRECTS: RouteObject[] = (
  [
    ['help', 'contacts'],
    ['report-issue', 'report'],
    ['queries', 'ask'],
  ] as const satisfies readonly (readonly [string, SupportTab])[]
).map(([from, tab]) => ({
  path: from,
  element: <Navigate to={supportPath(tab)} replace />,
}));

/**
 * `/staff/queries` and `/staff/issues` → the tab of `/staff/support` that now
 * carries each of them.
 *
 * The staff counterpart of `SUPPORT_REDIRECTS`, and kept for the same reason:
 * both paths are live in the overview board's alert rail, in `SupportPanel`'s
 * hand-off link, and on the duty list, quite apart from whatever a volunteer has
 * bookmarked mid-fest. Declared with absolute paths inside the staff block, so
 * they stay behind the same `requireTokenType="staff"` guard the originals were
 * behind rather than redirecting first and failing the guard second.
 */
const STAFF_SUPPORT_REDIRECTS: RouteObject[] = (
  [
    [ROUTES.queryConsole, 'questions'],
    [ROUTES.facilityIssues, 'faults'],
  ] as const satisfies readonly (readonly [string, StaffSupportTab])[]
).map(([from, tab]) => ({
  path: from,
  element: <Navigate to={staffSupportPath(tab)} replace />,
}));

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
 * Route table. Guards protect UI only — the backend enforces RBAC server-side.
 * Coarse gates (token type, super_admin) use ProtectedRoute; entity-scoped
 * permissions (event_head, team membership) are checked per-page after fetch.
 *
 * Exported separately from `router` so a test can mount the real table in a
 * memory router at any path — the browser router below is a singleton that
 * captures the document's location when this module first loads.
 */
export const routes: RouteObject[] = [
  { path: ROUTES.splash, element: <LandingPage />, errorElement: <ErrorPage /> },
  { path: ROUTES.login, element: <LoginPage />, errorElement: <ErrorPage /> },
  { path: ROUTES.register, element: <RegisterPage />, errorElement: <ErrorPage /> },
  { path: ROUTES.forgotPassword, element: <ForgotPasswordPage />, errorElement: <ErrorPage /> },
  { path: ROUTES.resetPassword, element: <ResetPasswordPage />, errorElement: <ErrorPage /> },
  { path: ROUTES.adminLogin, element: <AdminLoginPage />, errorElement: <ErrorPage /> },
  { path: ROUTES.accessDenied, element: <AccessDeniedPage />, errorElement: <ErrorPage /> },

  // Public festival brochure — no auth. Rendered from the static catalogue, so
  // these routes work offline and before a participant has an account.
  ...(
    [
      [ROUTES.publicEvents, <PublicEventsPage />],
      [ROUTES.publicEventCategory, <PublicEventsPage />],
      [ROUTES.publicEventDetail, <PublicEventDetailPage />],
      [ROUTES.publicSchedule, <PublicSchedulePage />],
      [ROUTES.publicWorkshops, <PublicWorkshopsPage />],
      [ROUTES.publicWorkshopDetail, <PublicWorkshopDetailPage />],
      [ROUTES.sponsors, <PublicSponsorsPage />],
    ] as const
  ).map(([path, element]) => ({
    path,
    errorElement: <ErrorPage />,
    element: <Lazy>{element}</Lazy>,
  })),

  {
    path: ROUTES.completeProfile,
    errorElement: <ErrorPage />,
    element: (
      <ProtectedRoute requireTokenType="participant">
        <Lazy>
          <CompleteProfilePage />
        </Lazy>
      </ProtectedRoute>
    ),
  },

  // Participant area — any authenticated participant.
  //
  // The guard is a pathless layout so that the index can sit *outside* `AppShell`:
  // `/app` is the participant's Landing Page, the same full-viewport PARADOX
  // portal a visitor gets, and it owns its own header. Every section below it
  // renders in the shell exactly as before.
  {
    path: ROUTES.home,
    errorElement: <ErrorPage />,
    element: (
      <ProtectedRoute requireTokenType="participant" requireCompleteProfile>
        <Outlet />
      </ProtectedRoute>
    ),
    children: [
      { index: true, element: <LandingPage /> },
      {
        element: <AppShell />,
        children: [
          { path: 'dashboard', element: <DashboardPage /> },
          { path: 'profile', element: <ProfilePage /> },
          { path: 'profile/change-password', element: <ChangePasswordPage /> },
          { path: 'qr', element: <MyQrPage /> },
          { path: 'events', element: <EventsListPage /> },
          { path: 'events/mine', element: <MyRegistrationsPage /> },
          { path: 'events/:eventId', element: <EventDetailPage /> },
          { path: 'schedule', element: <FestSchedulePage /> },
          { path: 'workshops', element: <WorkshopsListPage /> },
          { path: 'workshops/:workshopId', element: <WorkshopDetailPage /> },
          { path: 'accommodation', element: <AccommodationPage /> },
          { path: 'accommodation/payment', element: <StayPaymentPage /> },
          { path: 'support', element: <SupportPage /> },
          // The three routes Help & Support was consolidated out of. Kept as
          // redirects rather than deleted: they are on students' bookmarks and in
          // `AccommodationPage`, and a 404 on "Report a problem" is exactly the
          // impression this restructure set out to remove. `replace` so the back
          // button returns to wherever the old link was followed from rather than
          // bouncing through the redirect again.
          ...SUPPORT_REDIRECTS,
        ],
      },
    ],
  },

  // Staff area — the mirror of the participant block: `/staff` is the staff
  // Landing Page outside the shell, everything else inside it, one sticky
  // header, pages publish their own titles.
  {
    errorElement: <ErrorPage />,
    element: (
      <ProtectedRoute requireTokenType="staff">
        <Outlet />
      </ProtectedRoute>
    ),
    children: [
      { path: ROUTES.staffHome, element: <LandingPage /> },
      {
        element: <StaffShell />,
        children: [
          { path: ROUTES.staffDuties, element: <StaffHomePage /> },
          { path: ROUTES.staffChangePassword, element: <ChangePasswordPage /> },
          { path: ROUTES.scanMess, element: <MessScannerPage /> },
          { path: ROUTES.messMenu, element: <MessMenuPage /> },
          { path: ROUTES.staffSupport, element: <StaffSupportPage /> },
          // The two sections Support was consolidated out of. Redirects rather
          // than deletions: they are linked from the overview board and the duty
          // list, and are on volunteers' bookmarks mid-fest.
          ...STAFF_SUPPORT_REDIRECTS,
          { path: ROUTES.scanHostel, element: <HostelScannerPage /> },
          { path: ROUTES.scanEvent, element: <EventScannerPage /> },
          { path: ROUTES.scanWorkshop, element: <WorkshopScannerPage /> },
          // The on-spot desk is the same screen with its mode fixed by the path,
          // so a volunteer can be sent straight to the scanner they are staffing.
          { path: ROUTES.scanWorkshopOnSpot, element: <WorkshopScannerPage /> },
          { path: ROUTES.workshopManage, element: <WorkshopManagePage /> },
          { path: ROUTES.eventParticipation, element: <EventParticipationPage /> },
          { path: ROUTES.eventTeams, element: <EventTeamsPage /> },
        ],
      },
    ],
  },

  // Staff admin — super_admin only, same shell.
  {
    errorElement: <ErrorPage />,
    element: (
      <ProtectedRoute requireTokenType="staff" requireStaffRole="super_admin">
        <StaffShell />
      </ProtectedRoute>
    ),
    children: [
      { path: ROUTES.adminOverview, element: <AdminOverviewPage /> },
      { path: ROUTES.adminEvents, element: <AdminEventsPage /> },
      // `new` is a static segment, so it outranks the `:eventId` route below it.
      { path: ROUTES.adminEventNew, element: <AdminEventEditorPage /> },
      { path: ROUTES.adminEventEdit, element: <AdminEventEditorPage /> },
      { path: ROUTES.adminEventDetail, element: <AdminEventDetailPage /> },
      { path: ROUTES.adminWorkshops, element: <AdminWorkshopsPage /> },
      { path: ROUTES.adminWorkshopNew, element: <AdminWorkshopEditorPage /> },
      { path: ROUTES.adminWorkshopEdit, element: <AdminWorkshopEditorPage /> },
      { path: ROUTES.adminMess, element: <AdminMessPage /> },
      { path: ROUTES.adminHostels, element: <AdminHostelsPage /> },
      { path: ROUTES.adminBackendTeams, element: <AdminBackendTeamsPage /> },
      { path: ROUTES.adminParticipants, element: <AdminParticipantsPage /> },
      { path: ROUTES.adminAuditLogs, element: <AuditLogsPage /> },
      { path: ROUTES.adminEntityLogs, element: <EntityLogsPage /> },
    ],
  },

  { path: '*', element: <NotFoundPage />, errorElement: <ErrorPage /> },
];

export const router = createBrowserRouter(routes);
